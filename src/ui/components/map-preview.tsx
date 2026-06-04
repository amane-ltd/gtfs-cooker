import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import Map from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import { useControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, PathLayer, PolygonLayer, ArcLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import type { Layer } from '@deck.gl/core';
import { useAppStore } from '../../store/app-store';
import { computeBbox } from '../../geojson/helpers';
import type { FeatureCollection, Feature } from 'geojson';
import type { PickingInfo } from '@deck.gl/core';
import { TimeBar } from './time-bar';

const MAP_STYLE = `${import.meta.env.BASE_URL}pale_vector.json`;

const COLORS: Record<string, [number, number, number, number]> = {
  stops:            [231,  76,  60, 200],
  lines:            [ 52, 152, 219, 255],
  trips:            [ 46, 204, 113, 200],
  'stops-buffer':   [231,  76,  60,  50],
  'lines-buffer':   [ 52, 152, 219,  50],
  'stops-dissolved':[230, 126,  34,  60],
  'lines-dissolved':[155,  89, 182,  60],
  envelope:         [ 26, 188, 156,  40],
  convex:           [241, 196,  15,  50],
  concave:          [231,  76,  60,  50],
  segments:         [ 27, 186, 214, 230],
  'matching-stops': [231,  76,  60, 220],
  'matching-lines': [ 52, 152, 219, 255],
  'matching-segments':[ 27, 186, 214, 230],
  'matching-flow':  [155,  89, 182, 200],
  'matching-od':   [149, 165, 166, 100],
  'matching-trips': [233,  30,  99, 230],  // ピンク (Material Pink 500)
  'matching-ridership': [241, 196,  15, 220],
};

const OUTLINE_COLORS: Record<string, [number, number, number, number]> = {
  'stops-buffer':   [231,  76,  60, 150],
  'lines-buffer':   [ 52, 152, 219, 150],
  'stops-dissolved':[230, 126,  34, 180],
  'lines-dissolved':[155,  89, 182, 180],
  envelope:         [ 26, 188, 156, 255],
  convex:           [241, 196,  15, 255],
  concave:          [231,  76,  60, 255],
};

function DeckGLOverlay({ layers }: { layers: Layer[] }) {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ interleaved: false }),
  );
  overlay.setProps({ layers });
  return null;
}

interface HoverInfo {
  properties: Record<string, unknown>;
  layerId: string;
  index: number;
  sourceLayerId: string;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' && value.length > 120) return value.slice(0, 120) + '...';
  return String(value);
}

const POLYGON_LAYERS = new Set([
  'stops-buffer', 'lines-buffer',
  'stops-dissolved', 'lines-dissolved',
  'envelope', 'convex', 'concave',
]);

interface PolygonDatum {
  polygon: number[][][];
  feature: Feature;
}

function expandToPolygons(features: Feature[]): PolygonDatum[] {
  const result: PolygonDatum[] = [];
  for (const feat of features) {
    const g = feat.geometry;
    if (g.type === 'Polygon') {
      result.push({ polygon: g.coordinates as number[][][], feature: feat });
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates as number[][][][]) {
        result.push({ polygon: poly, feature: feat });
      }
    }
  }
  return result;
}

interface PathDatum {
  path: [number, number][];
  feature: Feature;
}

function expandToPaths(features: Feature[]): PathDatum[] {
  const result: PathDatum[] = [];
  for (const feat of features) {
    const g = feat.geometry;
    if (g.type === 'LineString') {
      result.push({ path: g.coordinates as [number, number][], feature: feat });
    } else if (g.type === 'MultiLineString') {
      for (const line of g.coordinates as [number, number][][]) {
        result.push({ path: line, feature: feat });
      }
    }
  }
  return result;
}

const HIGHLIGHT_COLOR: [number, number, number, number] = [230, 255, 0, 200];

/** 4-tuple 座標 [lon, lat, _, ts] を持つ feature かを判定 */
function hasTimestamps(fc: FeatureCollection): boolean {
  const f = fc.features[0];
  if (!f || f.geometry.type !== 'LineString') return false;
  const c = (f.geometry.coordinates as number[][])[0];
  return Array.isArray(c) && c.length >= 4 && typeof c[3] === 'number';
}

function buildDeckLayers(
  generatedLayers: Record<string, FeatureCollection>,
  onHover: (info: PickingInfo) => void,
  onClick: (info: PickingInfo) => void,
  pinnedInfo: HoverInfo | null,
  currentTime: number,
  timeBounds: { min: number; max: number } | null,
  trailLength: number,
  fadeTrail: boolean,
) {
  const layers: Layer[] = [];

  for (const [key, fc] of Object.entries(generatedLayers)) {
    if (fc.features.length === 0) continue;
    const color = COLORS[key] ?? [100, 100, 100, 200];

    // ── Animated layers: TripsLayer (時刻つき LineString) ──
    const animatable = key === 'trips' || key === 'matching-trips' || key === 'matching-ridership';
    if (animatable && hasTimestamps(fc) && timeBounds) {
      const widthFn = (d: Feature): number => {
        if (key === 'matching-trips') {
          const v = Number(d.properties?.onboard ?? 0);
          return Math.max(4, v * 3);
        }
        if (key === 'matching-ridership') {
          const v = Number(d.properties?.passenger_count ?? 1);
          return Math.max(4, v * 3);
        }
        // trips
        return 6;
      };
      layers.push(new TripsLayer({
        id: key,
        data: fc.features,
        getPath: (d: Feature) =>
          (d.geometry as unknown as { coordinates: number[][] }).coordinates.map(
            c => [c[0]!, c[1]!] as [number, number],
          ),
        getTimestamps: (d: Feature) =>
          (d.geometry as unknown as { coordinates: number[][] }).coordinates.map(
            c => Number(c[3] ?? 0),
          ),
        getColor: (_d: Feature, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : color,
        getWidth: widthFn,
        widthMinPixels: key === 'trips' ? 5 : 4,
        currentTime,
        trailLength,
        fadeTrail,
        capRounded: true,
        jointRounded: true,
        pickable: true,
        onHover,
        onClick,
        updateTriggers: {
          getColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index],
        },
      }));
      continue;
    }

    if (key === 'stops') {
      layers.push(new ScatterplotLayer({
        id: key,
        data: fc.features,
        getPosition: (d: Feature) => (d.geometry as unknown as { coordinates: [number, number] }).coordinates,
        getRadius: 50,
        radiusMinPixels: 3,
        radiusMaxPixels: 12,
        getFillColor: color,
        getLineColor: (_d: Feature, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : [255, 255, 255, 255],
        lineWidthMinPixels: (pinnedInfo?.sourceLayerId === key) ? 3 : 1,
        stroked: true,
        pickable: true,
        onHover,
        onClick,
        updateTriggers: { getLineColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index] },
      }));
    } else if (key === 'lines' || key === 'trips' || key === 'segments') {
      const pathData = expandToPaths(fc.features);
      const segmentCasingWidth = (d: PathDatum) => {
        const v = Number(d.feature.properties?.trip_weekday ?? 0);
        return Math.max(2, Math.sqrt(v) * 1.5 + 2);
      };
      const segmentWidth = (d: PathDatum) => {
        const v = Number(d.feature.properties?.trip_weekday ?? 0);
        return Math.max(1, Math.sqrt(v) * 1.2);
      };
      layers.push(new PathLayer({
        id: `${key}-casing`,
        data: pathData,
        getPath: (d: PathDatum) => d.path as unknown as number[],
        getWidth: key === 'segments' ? segmentCasingWidth : key === 'lines' ? 5 : 4,
        widthMinPixels: key === 'lines' ? 5 : 4,
        getColor: (_d: PathDatum, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : [255, 255, 255, key === 'trips' ? 150 : 230],
        pickable: false,
        updateTriggers: { getColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index] },
      }));
      const pathHoverClick = (handler: (info: PickingInfo) => void) => (info: PickingInfo) => {
        if (info.object) {
          const datum = info.object as PathDatum;
          handler({ ...info, object: datum.feature } as PickingInfo);
        } else {
          handler(info);
        }
      };
      layers.push(new PathLayer({
        id: key,
        data: pathData,
        getPath: (d: PathDatum) => d.path as unknown as number[],
        getWidth: key === 'segments' ? segmentWidth : key === 'lines' ? 2.5 : 1.5,
        widthMinPixels: key === 'lines' ? 2 : 1,
        getColor: color,
        pickable: true,
        onHover: pathHoverClick(onHover),
        onClick: pathHoverClick(onClick),
      }));
    } else if (POLYGON_LAYERS.has(key)) {
      const polyData = expandToPolygons(fc.features);
      const outlineColor = OUTLINE_COLORS[key] ?? color;
      const polyHoverClick = (handler: (info: PickingInfo) => void) => (info: PickingInfo) => {
        if (info.object) {
          const datum = info.object as PolygonDatum;
          handler({ ...info, object: datum.feature } as PickingInfo);
        } else {
          handler(info);
        }
      };
      layers.push(new PolygonLayer({
        id: key,
        data: polyData,
        getPolygon: (d: PolygonDatum) => d.polygon,
        getFillColor: color,
        getLineColor: (_d: PolygonDatum, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : outlineColor,
        getLineWidth: (_d: PolygonDatum, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? 4 : 2,
        lineWidthMinPixels: 1,
        filled: true,
        stroked: true,
        pickable: true,
        onHover: polyHoverClick(onHover),
        onClick: polyHoverClick(onClick),
        updateTriggers: { getLineColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index], getLineWidth: [pinnedInfo?.sourceLayerId, pinnedInfo?.index] },
      }));
    } else if (key === 'matching-stops') {
      layers.push(new ScatterplotLayer({
        id: key,
        data: fc.features,
        getPosition: (d: Feature) => (d.geometry as unknown as { coordinates: [number, number] }).coordinates,
        getRadius: (d: Feature) => {
          const on = Number(d.properties?.ridership_on ?? 0);
          const off = Number(d.properties?.ridership_off ?? 0);
          return Math.sqrt(on + off) * 20;
        },
        radiusMinPixels: 3,
        radiusMaxPixels: 60,
        getFillColor: color,
        getLineColor: (_d: Feature, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : [255, 255, 255, 255],
        lineWidthMinPixels: (pinnedInfo?.sourceLayerId === key) ? 3 : 1,
        stroked: true,
        pickable: true,
        onHover,
        onClick,
        updateTriggers: { getLineColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index] },
      }));
    } else if (key === 'matching-lines' || key === 'matching-segments') {
      const pathData = expandToPaths(fc.features);
      const matchPathHoverClick = (handler: (info: PickingInfo) => void) => (info: PickingInfo) => {
        if (info.object) {
          const datum = info.object as PathDatum;
          handler({ ...info, object: datum.feature } as PickingInfo);
        } else {
          handler(info);
        }
      };
      layers.push(new PathLayer({
        id: `${key}-casing`,
        data: pathData,
        getPath: (d: PathDatum) => d.path as unknown as number[],
        getWidth: (d: PathDatum) => {
          const val = key === 'matching-lines'
            ? Number(d.feature.properties?.ridership_count ?? 0)
            : Number(d.feature.properties?.ridership ?? 0);
          return Math.max(2, Math.sqrt(val) * 2 + 2);
        },
        widthMinPixels: 3,
        getColor: (_d: PathDatum, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : [255, 255, 255, 200],
        pickable: false,
        updateTriggers: { getColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index] },
      }));
      layers.push(new PathLayer({
        id: key,
        data: pathData,
        getPath: (d: PathDatum) => d.path as unknown as number[],
        getWidth: (d: PathDatum) => {
          const val = key === 'matching-lines'
            ? Number(d.feature.properties?.ridership_count ?? 0)
            : Number(d.feature.properties?.ridership ?? 0);
          return Math.max(1, Math.sqrt(val) * 1.5);
        },
        widthMinPixels: 1,
        getColor: color,
        pickable: true,
        onHover: matchPathHoverClick(onHover),
        onClick: matchPathHoverClick(onClick),
      }));
    } else if (key === 'matching-flow' || key === 'matching-od') {
      layers.push(new ArcLayer({
        id: key,
        data: fc.features,
        getSourcePosition: (d: Feature) => {
          const coords = (d.geometry as unknown as { coordinates: number[][] }).coordinates;
          return coords[0] as [number, number];
        },
        getTargetPosition: (d: Feature) => {
          const coords = (d.geometry as unknown as { coordinates: number[][] }).coordinates;
          return coords[1] as [number, number];
        },
        getSourceColor: (_d: Feature, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : color,
        getTargetColor: (_d: Feature, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : color,
        getWidth: key === 'matching-flow'
          ? (d: Feature) => Math.max(1, Math.sqrt(Number(d.properties?.ridership ?? 0)) * 2)
          : 1,
        widthMinPixels: key === 'matching-flow' ? 2 : 1,
        pickable: true,
        onHover,
        onClick,
        updateTriggers: { getSourceColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index], getTargetColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index] },
      }));
    } else if (key === 'matching-trips') {
      // 便ごとの区間 onboard を PathLayer で表示。線幅 ∝ √onboard
      const pathData = expandToPaths(fc.features);
      const tripHoverClick = (handler: (info: PickingInfo) => void) => (info: PickingInfo) => {
        if (info.object) {
          const datum = info.object as PathDatum;
          handler({ ...info, object: datum.feature } as PickingInfo);
        } else {
          handler(info);
        }
      };
      layers.push(new PathLayer({
        id: `${key}-casing`,
        data: pathData,
        getPath: (d: PathDatum) => d.path as unknown as number[],
        getWidth: (d: PathDatum) => {
          const v = Number(d.feature.properties?.onboard ?? 0);
          return Math.max(2, Math.sqrt(v) * 2 + 2);
        },
        widthMinPixels: 3,
        getColor: (_d: PathDatum, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : [255, 255, 255, 200],
        pickable: false,
        updateTriggers: { getColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index] },
      }));
      layers.push(new PathLayer({
        id: key,
        data: pathData,
        getPath: (d: PathDatum) => d.path as unknown as number[],
        getWidth: (d: PathDatum) => {
          const v = Number(d.feature.properties?.onboard ?? 0);
          return Math.max(1, Math.sqrt(v) * 1.5);
        },
        widthMinPixels: 1,
        getColor: color,
        pickable: true,
        onHover: tripHoverClick(onHover),
        onClick: tripHoverClick(onClick),
      }));
    } else if (key === 'matching-ridership') {
      // 個票単位の軌跡。Kepler.gl Trip 形式の 4 要素座標だが、現状の MapLibre 描画では
      // 単純な PathLayer として描く（将来的に TripsLayer による時刻アニメーションに拡張可能）。
      const pathData = expandToPaths(fc.features);
      const ridershipHoverClick = (handler: (info: PickingInfo) => void) => (info: PickingInfo) => {
        if (info.object) {
          const datum = info.object as PathDatum;
          handler({ ...info, object: datum.feature } as PickingInfo);
        } else {
          handler(info);
        }
      };
      layers.push(new PathLayer({
        id: key,
        data: pathData,
        getPath: (d: PathDatum) => {
          // Kepler.gl Trip format coordinates are [lon, lat, _, ts]; drop trailing
          return (d.path as unknown as number[][]).map(c => [c[0]!, c[1]!]) as unknown as number[];
        },
        getWidth: (d: PathDatum) => Math.max(1, Math.sqrt(Number(d.feature.properties?.passenger_count ?? 1)) * 1.2),
        widthMinPixels: 1,
        getColor: color,
        pickable: true,
        onHover: ridershipHoverClick(onHover),
        onClick: ridershipHoverClick(onClick),
      }));
    }
  }

  return layers;
}

export function MapPreview() {
  const generatedLayers = useAppStore(s => s.generatedLayers);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [pinnedInfo, setPinnedInfo] = useState<HoverInfo | null>(null);
  const is3D = useAppStore(s => s.is3D);
  const prevIs3D = useRef(is3D);
  const mapRef = useRef<MapRef>(null);

  const onHover = useCallback((info: PickingInfo) => {
    if (info.object && (info.object as Feature).properties) {
      setHoverInfo({
        properties: (info.object as Feature).properties as Record<string, unknown>,
        layerId: info.layer?.id ?? '',
        index: info.index,
        sourceLayerId: info.layer?.id ?? '',
      });
    } else {
      setHoverInfo(null);
    }
  }, []);

  const onClick = useCallback((info: PickingInfo) => {
    if (info.object && (info.object as Feature).properties) {
      setPinnedInfo({
        properties: (info.object as Feature).properties as Record<string, unknown>,
        layerId: info.layer?.id ?? '',
        index: info.index,
        sourceLayerId: info.layer?.id ?? '',
      });
    }
  }, []);

  const currentTime = useAppStore(s => s.currentTime);
  const timeBounds = useAppStore(s => s.timeBounds);
  const trailLength = useAppStore(s => s.trailLength);
  const fadeTrail = useAppStore(s => s.fadeTrail);
  const deckLayers = useMemo(
    () => buildDeckLayers(generatedLayers, onHover, onClick, pinnedInfo, currentTime, timeBounds, trailLength, fadeTrail),
    [generatedLayers, onHover, onClick, pinnedInfo, currentTime, timeBounds, trailLength, fadeTrail],
  );

  useEffect(() => {
    if (Object.keys(generatedLayers).length === 0) return;
    const bounds = computeBbox(generatedLayers);
    if (!bounds) return;
    const map = mapRef.current;
    if (!map) return;
    const [minLng, minLat, maxLng, maxLat] = bounds;
    map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 40, maxZoom: 16, duration: 800 },
    );
  }, [generatedLayers]);

  useEffect(() => {
    if (prevIs3D.current === is3D) return;
    prevIs3D.current = is3D;
    const map = mapRef.current;
    if (map) {
      map.easeTo({ pitch: is3D ? 60 : 0, bearing: is3D ? -15 : 0, duration: 600 });
    }
  }, [is3D]);

  const displayInfo = pinnedInfo ?? hoverInfo;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 139.7, latitude: 35.68, zoom: 10 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
        maxPitch={85}
        cursor={hoverInfo ? 'pointer' : ''}
        onClick={() => {
          if (!hoverInfo) setPinnedInfo(null);
        }}
      >
        <DeckGLOverlay layers={deckLayers} />
      </Map>
      {displayInfo && (
        <div className={`hover-panel${pinnedInfo ? ' pinned' : ''}`}>
          <div className="hover-panel-header">
            <span>{displayInfo.layerId}</span>
            {pinnedInfo && (
              <button className="hover-panel-close" onClick={() => setPinnedInfo(null)}>&times;</button>
            )}
          </div>
          <div className="hover-panel-body">
            <table className="hover-panel-table">
              <tbody>
                {Object.entries(displayInfo.properties).map(([key, val]) => (
                  <tr key={key}>
                    <td className="hover-panel-key">{key}</td>
                    <td className="hover-panel-val">{formatValue(val)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <TimeBar />
    </div>
  );
}
