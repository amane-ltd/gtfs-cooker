import type { Feature, FeatureCollection, Point, LineString, MultiLineString, Geometry } from 'geojson';

export function makePoint(
  coords: [number, number],
  properties: Record<string, unknown>,
  precision: number,
): Feature<Point> {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: roundCoords(coords, precision),
    },
    properties,
  };
}

export function makeLineString(
  coords: number[][],
  properties: Record<string, unknown>,
  precision?: number,
): Feature<LineString> {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: precision != null ? coords.map(c => roundCoords(c, precision)) : coords,
    },
    properties,
  };
}

export function makeMultiLineString(
  coords: number[][][],
  properties: Record<string, unknown>,
  precision?: number,
): Feature<MultiLineString> {
  return {
    type: 'Feature',
    geometry: {
      type: 'MultiLineString',
      coordinates: precision != null
        ? coords.map(ring => ring.map(c => roundCoords(c, precision)))
        : coords,
    },
    properties,
  };
}

export function makeFeatureCollection<G extends Geometry = Geometry>(
  features: Feature<G>[],
): FeatureCollection<G> {
  return { type: 'FeatureCollection', features };
}

function roundCoords<T extends number[]>(coords: T, precision: number): T {
  const factor = 10 ** precision;
  return coords.map(v => Math.round(v * factor) / factor) as unknown as T;
}

export function haversineDistance(
  lon1: number, lat1: number,
  lon2: number, lat2: number,
): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearestVertexIndex(
  coords: [number, number][],
  point: [number, number],
): number {
  let minDist = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < coords.length; i++) {
    const dx = coords[i]![0] - point[0];
    const dy = coords[i]![1] - point[1];
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function computeBbox(
  layers: Record<string, FeatureCollection>,
): [number, number, number, number] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  let hasCoords = false;

  for (const fc of Object.values(layers)) {
    for (const feat of fc.features) {
      visitCoords(feat.geometry, (lon, lat) => {
        hasCoords = true;
        if (lon < minLng) minLng = lon;
        if (lon > maxLng) maxLng = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      });
    }
  }

  if (!hasCoords) return null;
  if (!isFinite(minLng) || !isFinite(minLat) || !isFinite(maxLng) || !isFinite(maxLat)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function visitCoords(geom: Geometry, fn: (lon: number, lat: number) => void): void {
  switch (geom.type) {
    case 'Point':
      fn(geom.coordinates[0]!, geom.coordinates[1]!);
      break;
    case 'MultiPoint':
    case 'LineString':
      for (const c of geom.coordinates) fn(c[0]!, c[1]!);
      break;
    case 'MultiLineString':
    case 'Polygon':
      for (const ring of geom.coordinates) for (const c of ring) fn(c[0]!, c[1]!);
      break;
    case 'MultiPolygon':
      for (const poly of geom.coordinates) for (const ring of poly) for (const c of ring) fn(c[0]!, c[1]!);
      break;
    case 'GeometryCollection':
      for (const g of geom.geometries) visitCoords(g, fn);
      break;
  }
}
