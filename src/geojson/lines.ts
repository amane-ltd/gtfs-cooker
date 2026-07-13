import type { FeatureCollection, Feature, Geometry } from 'geojson';
import type { ShapePoint, RouteWithShapes } from '../db/queries';
import { normalizeColor } from '../gtfs/types';
import { makeLineString, makeMultiLineString, makeFeatureCollection } from './helpers';

/** lines 出力の絞り込み・集約オプション。 */
export interface LinesFilter {
  /** 絞り込み対象の列。 */
  column?: 'route_id' | 'route_short_name' | 'route_long_name';
  /** 出力対象とする値のリスト。空なら絞り込みなし。 */
  values?: string[];
  /** 絞り込んだ全路線を 1 フィーチャへ集約（dissolve）するか。 */
  aggregate?: boolean;
}

function colValue(route: RouteWithShapes, key: string): string {
  const v = route[key as keyof RouteWithShapes];
  return v == null ? '' : String(v);
}

/**
 * 集約時のプロパティ統合。
 * - trip_* などの数値列は合算（route_id ごとに重複しない便数なので合算が妥当）
 * - それ以外は重複排除し、複数あれば '; ' で結合
 */
function aggregateProps(
  routes: RouteWithShapes[],
  selectedProperties: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of selectedProperties) {
    if (key.startsWith('trip_')) {
      let sum = 0;
      for (const r of routes) sum += Number(r[key as keyof RouteWithShapes] ?? 0);
      out[key] = sum;
    } else {
      const distinct = new Set<string>();
      for (const r of routes) {
        const v = r[key as keyof RouteWithShapes];
        if (v != null && v !== '') distinct.add(String(v));
      }
      if (distinct.size === 0) out[key] = null;
      else if (distinct.size === 1) out[key] = [...distinct][0];
      else out[key] = [...distinct].join('; ');
    }
  }
  return out;
}

export function buildLinesGeoJSON(
  routes: RouteWithShapes[],
  shapePoints: ShapePoint[],
  selectedProperties: string[],
  precision: number,
  fallbackStops?: Map<string, Array<{ stop_lat: number; stop_lon: number }>>,
  filter?: LinesFilter,
): FeatureCollection {
  const shapeMap = new Map<string, [number, number][]>();
  for (const pt of shapePoints) {
    const coords = shapeMap.get(pt.shape_id);
    const coord: [number, number] = [pt.shape_pt_lon, pt.shape_pt_lat];
    if (coords) {
      coords.push(coord);
    } else {
      shapeMap.set(pt.shape_id, [coord]);
    }
  }

  // --- 絞り込み ---
  const filterCol = filter?.column ?? null;
  const valueSet = new Set(filter?.values ?? []);
  const applyFilter = filterCol !== null && valueSet.size > 0;

  const workRoutes = applyFilter
    ? routes.filter(r => valueSet.has(colValue(r, filterCol!)))
    : routes;

  // 各ルートの座標列（複数 shape の場合は配列で返す）
  function coordsForRoute(route: RouteWithShapes): [number, number][][] {
    const allCoords: [number, number][][] = [];
    for (const shapeId of route.shape_ids ?? []) {
      const coords = shapeMap.get(shapeId);
      if (coords && coords.length >= 2) allCoords.push(coords);
    }
    if (allCoords.length === 0 && fallbackStops) {
      const stops = fallbackStops.get(String(route.route_id));
      if (stops && stops.length >= 2) {
        allCoords.push(stops.map(s => [s.stop_lon, s.stop_lat] as [number, number]));
      }
    }
    return allCoords;
  }

  function normalizeColors(props: Record<string, unknown>): void {
    if (props.route_color) props.route_color = normalizeColor(props.route_color as string);
    if (props.route_text_color) props.route_text_color = normalizeColor(props.route_text_color as string);
  }

  function pushFeature(
    allCoords: [number, number][][],
    props: Record<string, unknown>,
    sink: Feature<Geometry>[],
  ): void {
    if (allCoords.length === 0) return;
    normalizeColors(props);
    if (allCoords.length === 1) {
      sink.push(makeLineString(allCoords[0]!, props, precision));
    } else {
      sink.push(makeMultiLineString(allCoords, props, precision));
    }
  }

  const features: Feature<Geometry>[] = [];

  if (applyFilter && filter?.aggregate) {
    // --- 絞り込んだ全路線を 1 フィーチャへ集約（dissolve） ---
    const allCoords: [number, number][][] = [];
    for (const route of workRoutes) allCoords.push(...coordsForRoute(route));
    pushFeature(allCoords, aggregateProps(workRoutes, selectedProperties), features);
  } else {
    // --- ルートごとに 1 フィーチャ（従来動作 + 絞り込み） ---
    for (const route of workRoutes) {
      const props: Record<string, unknown> = {};
      for (const key of selectedProperties) {
        const val = route[key as keyof RouteWithShapes];
        if (val !== undefined) props[key] = val;
      }
      pushFeature(coordsForRoute(route), props, features);
    }
  }

  return makeFeatureCollection(features);
}
