import type { FeatureCollection, Feature, LineString } from 'geojson';
import type { SegmentRow } from '../db/queries';
import { makeLineString, makeFeatureCollection, haversineDistance } from './helpers';
import { lineString, point } from '@turf/helpers';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import lineSlice from '@turf/line-slice';

/** shape_id → ポリライン座標 */
export interface ShapeGeometry {
  coords: [number, number][];
}

/** 停留所を shape に投影して区間を切り出す（常に投影ベース）。 */
function sliceByProjection(
  shape: ShapeGeometry,
  from: [number, number],
  to: [number, number],
): [number, number][] | null {
  const line = lineString(shape.coords);
  const start = nearestPointOnLine(line, point(from));
  const stop = nearestPointOnLine(line, point(to));
  const sliced = lineSlice(start, stop, line);
  const coords = sliced.geometry.coordinates as [number, number][];
  return coords.length >= 2 ? coords : null;
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

    // 既定は従来どおり直線。shape があれば投影で区間を切り出して置き換える
    let coords: [number, number][] = [from, to];
    const shape = seg.shape_id ? shapesById.get(seg.shape_id) : undefined;
    if (shape && shape.coords.length >= 2) {
      let sliced: [number, number][] | null = null;
      try {
        sliced = sliceByProjection(shape, from, to);
      } catch {
        sliced = null;
      }
      if (sliced && sliced.length >= 2) coords = sliced;
    }

    // distance_m は従来どおり停留所間の直線距離（区間長の指標）
    const distM = Math.round(haversineDistance(from[0], from[1], to[0], to[1]));

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
