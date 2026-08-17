import type { FeatureCollection, Feature, LineString } from 'geojson';
import type { TripStopTime, ShapePoint } from '../db/queries';
import { parseGtfsTime } from '../lib/time';
import { normalizeColor } from '../gtfs/types';
import { makeFeatureCollection, nearestVertexIndex, haversineDistance } from './helpers';

type Coord4 = [number, number, number, number];

function buildShapeMap(shapePoints: ShapePoint[]): Map<string, [number, number][]> {
  const map = new Map<string, [number, number][]>();
  for (const pt of shapePoints) {
    let arr = map.get(pt.shape_id);
    if (!arr) {
      arr = [];
      map.set(pt.shape_id, arr);
    }
    arr.push([pt.shape_pt_lon, pt.shape_pt_lat]);
  }
  return map;
}

function cumulativeDistances(coords: [number, number][]): number[] {
  const dists = [0];
  for (let i = 1; i < coords.length; i++) {
    dists.push(dists[i - 1]! + haversineDistance(coords[i - 1]![0], coords[i - 1]![1], coords[i]![0], coords[i]![1]));
  }
  return dists;
}

function interpolateAlongShape(
  shapeCoords: [number, number][],
  stops: { lon: number; lat: number; time: number }[],
): Coord4[] {
  if (stops.length < 2) return stops.map(s => [s.lon, s.lat, 0, s.time]);

  const snapIndices = stops.map(s => nearestVertexIndex(shapeCoords, [s.lon, s.lat]));

  for (let i = 1; i < snapIndices.length; i++) {
    if (snapIndices[i]! < snapIndices[i - 1]!) {
      snapIndices[i] = snapIndices[i - 1]!;
    }
  }

  const result: Coord4[] = [];

  for (let i = 0; i < stops.length - 1; i++) {
    const fromIdx = snapIndices[i]!;
    const toIdx = Math.max(snapIndices[i + 1]!, fromIdx);
    const tA = stops[i]!.time;
    const tB = stops[i + 1]!.time;

    const segment = shapeCoords.slice(fromIdx, toIdx + 1);

    if (segment.length < 2) {
      result.push([stops[i]!.lon, stops[i]!.lat, 0, tA]);
      continue;
    }

    const dists = cumulativeDistances(segment);
    const totalDist = dists[dists.length - 1]!;

    for (let j = 0; j < segment.length; j++) {
      const frac = totalDist > 0 ? dists[j]! / totalDist : 0;
      const t = tA + frac * (tB - tA);
      result.push([segment[j]![0], segment[j]![1], 0, t]);
    }
  }

  const lastStop = stops[stops.length - 1]!;
  result.push([lastStop.lon, lastStop.lat, 0, lastStop.time]);

  return result;
}

function linearInterpolate(
  stops: { lon: number; lat: number; time: number }[],
): Coord4[] {
  return stops.map(s => [s.lon, s.lat, 0, s.time]);
}

function roundCoord4(coords: Coord4[], precision: number): Coord4[] {
  const factor = 10 ** precision;
  return coords.map(([lon, lat, alt, t]) => [
    Math.round(lon * factor) / factor,
    Math.round(lat * factor) / factor,
    alt,
    Math.round(t),
  ]);
}

export function buildAnimationGeoJSON(
  stopTimes: TripStopTime[],
  baseDateStr: string,
  selectedProperties: string[],
  precision: number,
  shapePoints: ShapePoint[] = [],
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

  const shapeMap = buildShapeMap(shapePoints);

  const features: Feature<LineString>[] = [];

  for (const [, tripStops] of tripGroups) {
    if (tripStops.length < 2) continue;

    tripStops.sort((a, b) => a.stop_sequence - b.stop_sequence);

    const validStops = tripStops
      .filter(s => s.departure_time)
      .map(s => ({
        lon: s.stop_lon,
        lat: s.stop_lat,
        time: parseGtfsTime(s.departure_time, baseDateStr),
      }));

    if (validStops.length < 2) continue;

    const first = tripStops[0]!;
    const shapeId = first.shape_id;
    const shapeCoords = shapeId ? shapeMap.get(shapeId) : undefined;

    let coordinates: Coord4[];
    if (shapeCoords && shapeCoords.length >= 2) {
      coordinates = interpolateAlongShape(shapeCoords, validStops);
    } else {
      coordinates = linearInterpolate(validStops);
    }

    if (coordinates.length < 2) continue;

    const props: Record<string, unknown> = {};
    for (const key of selectedProperties) {
      const val = first[key as keyof TripStopTime];
      if (val !== undefined) props[key] = val;
    }
    if (props.route_color) {
      props.route_color = normalizeColor(props.route_color as string);
    }

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: roundCoord4(coordinates, precision),
      },
      properties: props,
    });
  }

  return makeFeatureCollection(features);
}
