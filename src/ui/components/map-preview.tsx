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
  animation:        [ 46, 204, 113, 200],
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
  'matching-trips':  [230, 126,  34, 230],  // オレンジ (Material Orange 600)
  'matching-animation': [233,  30,  99, 230],  // ピンク (Material Pink 500)
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

/** matching 系レイヤーの「最大値 → 固定ピクセル幅」正規化用の目標値 */
const MATCHING_MAX_PX: Record<string, number> = {
  'matching-stops': 14,      // 半径（ピクセル）
  'matching-lines': 10,
  'matching-segments': 10,
  'matching-flow': 10,
  'matching-od': 10,
  'matching-trips': 10,
  'matching-animation': 10,
  'matching-ridership': 10,
};

/** feature 群から値の最大を求める（0 以下は無視） */
function maxOfFeatures(features: Feature[], getVal: (f: Feature) => number): number {
  let m = 0;
  for (const f of features) {
    const v = getVal(f);
    if (v > m) m = v;
  }
  return m;
}

/** 値を「最大値 → maxPx」に正規化した幅（√スケール）。値 0 以下は 0（非表示）。 */
function normSize(val: number, maxVal: number, maxPx: number, minPx = 1.5): number {
  if (val <= 0 || maxVal <= 0) return 0;
  return Math.max(minPx, maxPx * Math.sqrt(val) / Math.sqrt(maxVal));
}

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
    const animatable = key === 'animation' || key === 'matching-animation' || key === 'matching-ridership';
    if (animatable && hasTimestamps(fc) && timeBounds) {
      // matching 系は値（onboard / passenger_count）に比例し、最大値が固定ピクセル幅になるよう正規化
      const animVal = (f: Feature) =>
        key === 'matching-animation' ? Number(f.properties?.onboard ?? 0)
        : key === 'matching-ridership' ? Number(f.properties?.passenger_count ?? 0)
        : 0;
      const animMax = maxOfFeatures(fc.features, animVal);
      const animMaxPx = MATCHING_MAX_PX[key] ?? 10;
      const widthFn = (d: Feature): number => {
        if (key === 'animation') return 6;
        return normSize(animVal(d), animMax, animMaxPx, 3);
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
        widthUnits: key === 'animation' ? 'meters' : 'pixels',
        widthMinPixels: key === 'animation' ? 5 : 0,
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
        // 選択中の Point のみ黄色く太い枠線で強調し、それ以外は細い白枠のまま。
        getLineColor: (_d: Feature, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : [255, 255, 255, 255],
        getLineWidth: (_d: Feature, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? 4 : 1,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        stroked: true,
        pickable: true,
        onHover,
        onClick,
        updateTriggers: {
          getLineColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index],
          getLineWidth: [pinnedInfo?.sourceLayerId, pinnedInfo?.index],
        },
      }));
    } else if (key === 'lines' || key === 'animation' || key === 'segments') {
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
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : [255, 255, 255, key === 'animation' ? 150 : 230],
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
      const stopVal = (f: Feature) => Number(f.properties?.ridership_on ?? 0) + Number(f.properties?.ridership_off ?? 0);
      const maxStop = maxOfFeatures(fc.features, stopVal);
      layers.push(new ScatterplotLayer({
        id: key,
        data: fc.features,
        getPosition: (d: Feature) => (d.geometry as unknown as { coordinates: [number, number] }).coordinates,
        // 半径は乗降人数に比例し、最大値が固定ピクセル半径になるよう正規化。無ければ 0（非表示）
        getRadius: (d: Feature) => normSize(stopVal(d), maxStop, MATCHING_MAX_PX['matching-stops']!, 2),
        radiusUnits: 'pixels',
        radiusMinPixels: 0,
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
      const lineVal = (f: Feature) => key === 'matching-lines'
        ? Number(f.properties?.ridership_count ?? 0)
        : Number(f.properties?.onboard ?? 0);
      const maxLine = maxOfFeatures(fc.features, lineVal);
      const maxPx = MATCHING_MAX_PX[key]!;
      const matchPathHoverClick = (handler: (info: PickingInfo) => void) => (info: PickingInfo) => {
        if (info.object) {
          const datum = info.object as PathDatum;
          handler({ ...info, object: datum.feature } as PickingInfo);
        } else {
          handler(info);
        }
      };
      // 幅は ridership に比例し、最大値が固定ピクセル幅になるよう正規化。無ければ 0（非表示）
      layers.push(new PathLayer({
        id: `${key}-casing`,
        data: pathData,
        getPath: (d: PathDatum) => d.path as unknown as number[],
        widthUnits: 'pixels',
        getWidth: (d: PathDatum) => normSize(lineVal(d.feature), maxLine, maxPx + 3, 3.5),
        widthMinPixels: 0,
        getColor: (_d: PathDatum, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : [255, 255, 255, 200],
        pickable: false,
        updateTriggers: { getColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index] },
      }));
      layers.push(new PathLayer({
        id: key,
        data: pathData,
        getPath: (d: PathDatum) => d.path as unknown as number[],
        widthUnits: 'pixels',
        getWidth: (d: PathDatum) => normSize(lineVal(d.feature), maxLine, maxPx, 1.5),
        widthMinPixels: 0,
        getColor: color,
        pickable: true,
        onHover: matchPathHoverClick(onHover),
        onClick: matchPathHoverClick(onClick),
      }));
    } else if (key === 'matching-flow' || key === 'matching-od') {
      const arcVal = (f: Feature) => key === 'matching-flow'
        ? Number(f.properties?.ridership ?? 0)
        : Number(f.properties?.passenger_count ?? 0);
      const maxArc = maxOfFeatures(fc.features, arcVal);
      const arcMaxPx = MATCHING_MAX_PX[key]!;
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
        // 幅は ridership（od は passenger_count）に比例し、最大値が固定ピクセル幅になるよう正規化
        getWidth: (d: Feature) => normSize(arcVal(d), maxArc, arcMaxPx, 1.5),
        widthMinPixels: 0,
        pickable: true,
        onHover,
        onClick,
        updateTriggers: { getSourceColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index], getTargetColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index] },
      }));
    } else if (key === 'matching-animation' || key === 'matching-trips') {
      // 便ごとの区間 onboard を PathLayer で表示。幅は onboard に比例し最大値が固定ピクセル幅
      const pathData = expandToPaths(fc.features);
      const tripVal = (f: Feature) => Number(f.properties?.onboard ?? 0);
      const maxTrip = maxOfFeatures(fc.features, tripVal);
      const tripMaxPx = MATCHING_MAX_PX[key]!;
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
        widthUnits: 'pixels',
        getWidth: (d: PathDatum) => normSize(tripVal(d.feature), maxTrip, tripMaxPx + 3, 3.5),
        widthMinPixels: 0,
        getColor: (_d: PathDatum, { index }: { index: number }) =>
          pinnedInfo?.sourceLayerId === key && pinnedInfo.index === index ? HIGHLIGHT_COLOR : [255, 255, 255, 200],
        pickable: false,
        updateTriggers: { getColor: [pinnedInfo?.sourceLayerId, pinnedInfo?.index] },
      }));
      layers.push(new PathLayer({
        id: key,
        data: pathData,
        getPath: (d: PathDatum) => d.path as unknown as number[],
        widthUnits: 'pixels',
        getWidth: (d: PathDatum) => normSize(tripVal(d.feature), maxTrip, tripMaxPx, 1.5),
        widthMinPixels: 0,
        getColor: color,
        pickable: true,
        onHover: tripHoverClick(onHover),
        onClick: tripHoverClick(onClick),
      }));
    } else if (key === 'matching-ridership') {
      // 個票単位の軌跡。Kepler.gl Trip 形式の 4 要素座標だが、現状の MapLibre 描画では
      // 単純な PathLayer として描く（将来的に TripsLayer による時刻アニメーションに拡張可能）。
      const pathData = expandToPaths(fc.features);
      const rideVal = (f: Feature) => Number(f.properties?.passenger_count ?? 0);
      const maxRide = maxOfFeatures(fc.features, rideVal);
      const rideMaxPx = MATCHING_MAX_PX['matching-ridership']!;
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
        // 幅は passenger_count に比例し、最大値が固定ピクセル幅になるよう正規化
        widthUnits: 'pixels',
        getWidth: (d: PathDatum) => normSize(rideVal(d.feature), maxRide, rideMaxPx, 1.5),
        widthMinPixels: 0,
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
