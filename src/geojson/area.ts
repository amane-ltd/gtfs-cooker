import { bbox } from '@turf/bbox';
import { bboxPolygon } from '@turf/bbox-polygon';
import { convex } from '@turf/convex';
import { concave } from '@turf/concave';
import type { FeatureCollection, Feature, Polygon } from 'geojson';

export function buildEnvelope(
  stopsFC: FeatureCollection,
  agencyName: string | null,
): FeatureCollection<Polygon> {
  if (stopsFC.features.length === 0) return { type: 'FeatureCollection', features: [] };

  const bboxArr = bbox(stopsFC);
  const envelope = bboxPolygon(bboxArr);

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: envelope.geometry,
      properties: {
        agency_name: agencyName,
        bbox: [bboxArr[0], bboxArr[1], bboxArr[2], bboxArr[3]],
      },
    }],
  };
}

export function buildConvexHull(
  stopsFC: FeatureCollection,
  agencyName: string | null,
): FeatureCollection<Polygon> {
  if (stopsFC.features.length === 0) return { type: 'FeatureCollection', features: [] };

  const hull = convex(stopsFC);
  if (!hull) return { type: 'FeatureCollection', features: [] };

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: hull.geometry,
      properties: { agency_name: agencyName },
    }],
  };
}

export function buildConcaveHull(
  stopsFC: FeatureCollection,
  maxEdge: number,
  agencyName: string | null,
): FeatureCollection<Polygon> {
  if (stopsFC.features.length === 0) return { type: 'FeatureCollection', features: [] };

  const hull = concave(stopsFC, { maxEdge, units: 'kilometers' });
  if (!hull) {
    const fallback = convex(stopsFC);
    if (!fallback) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: fallback.geometry,
        properties: { agency_name: agencyName },
      }],
    };
  }

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: hull.geometry,
      properties: { agency_name: agencyName },
    }],
  };
}
