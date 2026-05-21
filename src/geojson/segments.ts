import type { FeatureCollection, Feature, LineString } from 'geojson';
import type { SegmentRow } from '../db/queries';
import { makeLineString, makeFeatureCollection, haversineDistance } from './helpers';

export function buildSegmentsGeoJSON(
  segments: SegmentRow[],
  selectedProperties: string[],
  precision: number,
): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];

  for (const seg of segments) {
    const from: [number, number] = [seg.from_stop_lon, seg.from_stop_lat];
    const to: [number, number] = [seg.to_stop_lon, seg.to_stop_lat];

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

    features.push(makeLineString([from, to], props, precision));
  }

  return makeFeatureCollection(features);
}
