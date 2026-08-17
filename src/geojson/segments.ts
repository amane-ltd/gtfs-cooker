import type { FeatureCollection, Feature, LineString } from 'geojson';
import type { SegmentRow } from '../db/queries';
import { makeLineString, makeFeatureCollection, haversineDistance } from './helpers';

/** shape_id → ポリライン座標 */
export interface ShapeGeometry {
  coords: [number, number][];
}

/** shape の累積距離（メートル）・総延長・閉ループ判定をキャッシュ */
interface ShapeIndex {
  coords: [number, number][];
  cum: number[]; // cum[i] = 先頭から頂点 i までの距離(m)
  total: number;
  closed: boolean; // 始点と終点がほぼ一致する循環形状か
}

// 停留所が shape に「十分近い」とみなす閾値（m）と、谷を抜けたと判定する余裕（m）
const APPROACH_THRESHOLD_M = 60;
const LEAVE_MARGIN_M = 5;
// 閉ループとみなす始点・終点の距離（m）
const LOOP_CLOSE_M = 30;

const shapeIndexCache = new WeakMap<ShapeGeometry, ShapeIndex>();

function getIndex(shape: ShapeGeometry): ShapeIndex {
  let idx = shapeIndexCache.get(shape);
  if (!idx) {
    const coords = shape.coords;
    const cum = new Array<number>(coords.length);
    cum[0] = 0;
    for (let i = 1; i < coords.length; i++) {
      cum[i] = cum[i - 1]! + haversineDistance(
        coords[i - 1]![0], coords[i - 1]![1], coords[i]![0], coords[i]![1],
      );
    }
    const total = cum[coords.length - 1]!;
    const first = coords[0]!;
    const last = coords[coords.length - 1]!;
    const closed = haversineDistance(first[0], first[1], last[0], last[1]) < LOOP_CLOSE_M;
    idx = { coords, cum, total, closed };
    shapeIndexCache.set(shape, idx);
  }
  return idx;
}

/**
 * 点を shape に投影し、閾値以下に最初に近づいた「谷」（最初の接近箇所）の along を返す。
 * ループ路線で後方の別通過箇所（距離的に近いことがある）へ誤スナップするのを防ぐ。
 */
function project(idx: ShapeIndex, lon: number, lat: number): { along: number; perp: number } | null {
  const { coords, cum } = idx;
  let best: { along: number; perp: number } | null = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const latRef = ((a[1] + b[1]) / 2) * Math.PI / 180;
    const mx = 111320 * Math.cos(latRef);
    const my = 110540;
    const bx = (b[0] - a[0]) * mx;
    const by = (b[1] - a[1]) * my;
    const px = (lon - a[0]) * mx;
    const py = (lat - a[1]) * my;
    const len2 = bx * bx + by * by;
    let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const along = cum[i]! + t * (cum[i + 1]! - cum[i]!);
    const cx = t * bx;
    const cy = t * by;
    const perp = Math.hypot(px - cx, py - cy);
    if (!best || perp < best.perp) {
      best = { along, perp };
    } else if (best.perp <= APPROACH_THRESHOLD_M && perp > best.perp + LEAVE_MARGIN_M) {
      break; // 十分近づいた谷を通過して離れ始めた → 最初の接近箇所を確定
    }
  }
  return best;
}

/**
 * shape 幾何をグラフとみなし、2 停留所（along a0→a1）間の最短経路の頂点列を返す。
 * - 開いた形状: a0→a1 の直接部分経路
 * - 閉ループ: 前方 / 後方の短い方の弧（循環路線の「終点→始発」等に対応）
 * 返り値の length は経路の along 距離（誤スナップ判定に使用）。
 */
function shortestArc(idx: ShapeIndex, a0: number, a1: number): { coords: [number, number][]; length: number } {
  const { coords, cum, total, closed } = idx;
  const verts = coords.map((coord, i) => ({ cum: cum[i]!, coord }));
  const EPS = 1e-6;

  if (closed && total > 0) {
    const fLen = (((a1 - a0) % total) + total) % total; // 前方（along 増加・seam でラップ）
    const bLen = total - fLen; // 後方
    if (fLen <= bLen) {
      const arc = verts
        .map(v => ({ pos: (((v.cum - a0) % total) + total) % total, coord: v.coord }))
        .filter(v => v.pos > EPS && v.pos < fLen - EPS)
        .sort((p, q) => p.pos - q.pos)
        .map(v => v.coord);
      return { coords: arc, length: fLen };
    }
    const arc = verts
      .map(v => ({ pos: (((a0 - v.cum) % total) + total) % total, coord: v.coord }))
      .filter(v => v.pos > EPS && v.pos < bLen - EPS)
      .sort((p, q) => p.pos - q.pos)
      .map(v => v.coord);
    return { coords: arc, length: bLen };
  }

  // 開いた形状: 直接の部分経路
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  const interior = verts.filter(v => v.cum > lo + EPS && v.cum < hi - EPS).map(v => v.coord);
  if (a0 > a1) interior.reverse();
  return { coords: interior, length: hi - lo };
}

/** 連続する重複座標を除去 */
function dedupe(path: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of path) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;
}

export function buildSegmentsGeoJSON(
  segments: SegmentRow[],
  shapesById: Map<string, ShapeGeometry>,
  selectedProperties: string[],
  precision: number,
): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];

  for (const seg of segments) {
    const from: [number, number] = [seg.from_stop_lon, seg.from_stop_lat];
    const to: [number, number] = [seg.to_stop_lon, seg.to_stop_lat];
    const straight = haversineDistance(from[0], from[1], to[0], to[1]);

    // 既定は直線。shape があれば「shape 上の最短経路」で区間を切り出して置き換える
    let coords: [number, number][] = [from, to];
    const shape = seg.shape_id ? shapesById.get(seg.shape_id) : undefined;
    if (shape && shape.coords.length >= 2) {
      const idx = getIndex(shape);
      const pf = project(idx, from[0], from[1]);
      const pt = project(idx, to[0], to[1]);
      if (pf && pt) {
        const arc = shortestArc(idx, pf.along, pt.along);
        // 誤スナップによる大遠回りだけを弾く安全弁（正当な長区間・迂回路は許容）
        if (arc.length <= Math.max(straight * 6 + 300, straight + 800)) {
          const path = dedupe([from, ...arc.coords, to]);
          if (path.length >= 2) coords = path;
        }
      }
    }

    // distance_m は従来どおり停留所間の直線距離（区間長の指標）
    const distM = Math.round(straight);

    const props: Record<string, unknown> = {};
    const allProps: Record<string, unknown> = {
      ...seg,
      distance_m: distM,
    };

    for (const key of selectedProperties) {
      if (key in allProps) {
        props[key] = allProps[key];
      }
    }

    features.push(makeLineString(coords, props, precision));
  }

  return makeFeatureCollection(features);
}
