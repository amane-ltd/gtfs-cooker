import { buffer } from '@turf/buffer';
import { union } from '@turf/union';
import { simplify } from '@turf/simplify';
import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';

function bufferAndSimplify(
  feat: Feature,
  radiusKm: number,
): Feature<Polygon | MultiPolygon> | null {
  const buffered = buffer(feat, radiusKm, { units: 'kilometers' });
  if (!buffered) return null;
  return simplify(buffered, { tolerance: 0.00005, highQuality: true });
}

function unionPolygons(
  polys: Feature<Polygon | MultiPolygon>[],
): Feature<Polygon | MultiPolygon> | null {
  if (polys.length === 0) return null;
  if (polys.length === 1) return polys[0]!;
  const fc: FeatureCollection<Polygon | MultiPolygon> = {
    type: 'FeatureCollection',
    features: polys,
  };
  return union(fc) ?? null;
}

export function buildStopsDissolved(
  stopsFC: FeatureCollection,
  radiusMeters: number,
  properties: Record<string, unknown>,
  groupBy?: string,
  groupListKey?: string,
): FeatureCollection<Polygon | MultiPolygon> {
  const radiusKm = radiusMeters / 1000;

  if (!groupBy || groupBy === 'none') {
    const polys: Feature<Polygon | MultiPolygon>[] = [];
    for (const feat of stopsFC.features) {
      const b = bufferAndSimplify(feat, radiusKm);
      if (b) polys.push(b);
    }
    const merged = unionPolygons(polys);
    if (!merged) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: merged.geometry, properties }],
    };
  }

  const groups = new Map<string, Feature<Polygon | MultiPolygon>[]>();

  for (const feat of stopsFC.features) {
    let groupVals: string[];

    if (groupBy === 'route_id' && groupListKey === 'routes') {
      const routes = feat.properties?.routes;
      if (Array.isArray(routes)) {
        groupVals = routes.map(String).filter(v => v !== '');
      } else if (typeof routes === 'string' && routes) {
        groupVals = routes.split(',').filter(v => v !== '');
      } else {
        continue;
      }
    } else {
      const val = feat.properties?.[groupBy];
      if (val == null || val === '') continue;
      groupVals = [String(val)];
    }

    const b = bufferAndSimplify(feat, radiusKm);
    if (!b) continue;

    for (const gv of groupVals) {
      if (!groups.has(gv)) groups.set(gv, []);
      groups.get(gv)!.push({ ...b });
    }
  }

  const features: Feature<Polygon | MultiPolygon>[] = [];
  for (const [groupVal, polys] of groups) {
    const merged = unionPolygons(polys);
    if (!merged) continue;
    features.push({
      type: 'Feature',
      geometry: merged.geometry,
      properties: { [groupBy]: groupVal },
    });
  }

  return { type: 'FeatureCollection', features };
}

export function buildLinesDissolved(
  linesFC: FeatureCollection,
  radiusMeters: number,
  properties: Record<string, unknown>,
  groupBy?: string,
): FeatureCollection<Polygon | MultiPolygon> {
  const radiusKm = radiusMeters / 1000;

  if (!groupBy || groupBy === 'none') {
    const polys: Feature<Polygon | MultiPolygon>[] = [];
    for (const feat of linesFC.features) {
      const b = bufferAndSimplify(feat, radiusKm);
      if (b) polys.push(b);
    }
    const merged = unionPolygons(polys);
    if (!merged) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: merged.geometry, properties }],
    };
  }

  const groups = new Map<string, Feature<Polygon | MultiPolygon>[]>();
  for (const feat of linesFC.features) {
    const val = feat.properties?.[groupBy];
    if (val == null || val === '') continue;
    const gv = String(val);
    const b = bufferAndSimplify(feat, radiusKm);
    if (!b) continue;
    if (!groups.has(gv)) groups.set(gv, []);
    groups.get(gv)!.push(b);
  }

  const features: Feature<Polygon | MultiPolygon>[] = [];
  for (const [groupVal, polys] of groups) {
    const merged = unionPolygons(polys);
    if (!merged) continue;
    features.push({
      type: 'Feature',
      geometry: merged.geometry,
      properties: { [groupBy]: groupVal },
    });
  }

  return { type: 'FeatureCollection', features };
}
