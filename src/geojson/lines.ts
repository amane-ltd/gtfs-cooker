import type { FeatureCollection, Feature, Geometry } from 'geojson';
import type { ShapePoint, RouteWithShapes } from '../db/queries';
import { normalizeColor } from '../gtfs/types';
import { makeLineString, makeMultiLineString, makeFeatureCollection } from './helpers';

export function buildLinesGeoJSON(
  routes: RouteWithShapes[],
  shapePoints: ShapePoint[],
  selectedProperties: string[],
  precision: number,
  fallbackStops?: Map<string, Array<{ stop_lat: number; stop_lon: number }>>,
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

  const features: Feature<Geometry>[] = [];

  for (const route of routes) {
    const props: Record<string, unknown> = {};
    for (const key of selectedProperties) {
      const val = route[key as keyof RouteWithShapes];
      if (val !== undefined) props[key] = val;
    }
    if (props.route_color) {
      props.route_color = normalizeColor(props.route_color as string);
    }
    if (props.route_text_color) {
      props.route_text_color = normalizeColor(props.route_text_color as string);
    }

    const routeShapeIds = route.shape_ids ?? [];

    const allCoords: [number, number][][] = [];
    for (const shapeId of routeShapeIds) {
      const coords = shapeMap.get(shapeId);
      if (coords && coords.length >= 2) {
        allCoords.push(coords);
      }
    }

    if (allCoords.length === 0 && fallbackStops) {
      const stops = fallbackStops.get(String(route.route_id));
      if (stops && stops.length >= 2) {
        allCoords.push(stops.map(s => [s.stop_lon, s.stop_lat] as [number, number]));
      }
    }

    if (allCoords.length === 0) continue;

    if (allCoords.length === 1) {
      features.push(makeLineString(allCoords[0]!, props, precision));
    } else {
      features.push(makeMultiLineString(allCoords, props, precision));
    }
  }

  return makeFeatureCollection(features);
}
