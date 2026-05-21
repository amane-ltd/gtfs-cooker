import type { FeatureCollection, Point } from 'geojson';
import type { StopRow } from '../db/queries';
import { normalizeColor } from '../gtfs/types';
import { makePoint, makeFeatureCollection } from './helpers';

export function buildStopsGeoJSON(
  rows: StopRow[],
  selectedProperties: string[],
  precision: number,
): FeatureCollection<Point> {
  const features = rows
    .filter(row => row.stop_lat != null && row.stop_lon != null)
    .map(row => {
      const props: Record<string, unknown> = {};
      for (const key of selectedProperties) {
        if (key in row) {
          props[key] = row[key];
        }
      }
      if (props.route_color) {
        props.route_color = normalizeColor(props.route_color as string);
      }
      return makePoint(
        [Number(row.stop_lon), Number(row.stop_lat)],
        props,
        precision,
      );
    });

  return makeFeatureCollection(features);
}
