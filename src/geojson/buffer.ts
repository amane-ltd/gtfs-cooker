import { buffer } from '@turf/buffer';
import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';

export function buildStopsBuffer(
  stopsFC: FeatureCollection,
  radiusMeters: number,
): FeatureCollection<Polygon | MultiPolygon> {
  const radiusKm = radiusMeters / 1000;
  const features: Feature<Polygon | MultiPolygon>[] = [];
  for (const feat of stopsFC.features) {
    const buffered = buffer(feat, radiusKm, { units: 'kilometers' });
    if (buffered) {
      features.push({
        type: 'Feature',
        geometry: buffered.geometry,
        properties: { ...feat.properties },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

export function buildLinesBuffer(
  linesFC: FeatureCollection,
  radiusMeters: number,
): FeatureCollection<Polygon | MultiPolygon> {
  const radiusKm = radiusMeters / 1000;
  const features: Feature<Polygon | MultiPolygon>[] = [];
  for (const feat of linesFC.features) {
    const buffered = buffer(feat, radiusKm, { units: 'kilometers' });
    if (buffered) {
      features.push({
        type: 'Feature',
        geometry: buffered.geometry,
        properties: { ...feat.properties },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}
