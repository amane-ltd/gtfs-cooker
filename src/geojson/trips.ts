import { featureCollection } from '@turf/helpers';
import truncate from '@turf/truncate';
import type { FeatureCollection, Feature, LineString } from 'geojson';
import type { TripStopTime } from '../db/queries';
import { parseGtfsTime } from '../lib/time';
import { normalizeColor } from '../gtfs/types';

export function buildTripsGeoJSON(
  stopTimes: TripStopTime[],
  baseDateStr: string,
  selectedProperties: string[],
  precision: number,
): FeatureCollection<LineString> {
  const tripGroups = new Map<string, TripStopTime[]>();
  for (const st of stopTimes) {
    const group = tripGroups.get(st.trip_id);
    if (group) {
      group.push(st);
    } else {
      tripGroups.set(st.trip_id, [st]);
    }
  }

  const features: Feature<LineString>[] = [];

  for (const [, stops] of tripGroups) {
    if (stops.length < 2) continue;

    stops.sort((a, b) => a.stop_sequence - b.stop_sequence);

    const coordinates: [number, number, number, number][] = stops
      .filter(s => s.departure_time)
      .map(s => [
        s.stop_lon,
        s.stop_lat,
        0,
        parseGtfsTime(s.departure_time, baseDateStr),
      ]);

    if (coordinates.length < 2) continue;

    const first = stops[0]!;
    const props: Record<string, unknown> = {};
    for (const key of selectedProperties) {
      const val = first[key as keyof TripStopTime];
      if (val !== undefined) props[key] = val;
    }
    if (props.route_color) {
      props.route_color = normalizeColor(props.route_color as string);
    }

    const feature: Feature<LineString> = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates,
      },
      properties: props,
    };

    features.push(truncate(feature, { precision, coordinates: 4 }) as Feature<LineString>);
  }

  return featureCollection(features);
}
