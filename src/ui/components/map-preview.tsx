import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import Map, { Source, Layer } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore } from '../../store/app-store';
import type { LayerSpecification, MapLayerMouseEvent } from 'maplibre-gl';
import bbox from '@turf/bbox';
import { featureCollection } from '@turf/helpers';
import type { FeatureCollection, Feature } from 'geojson';

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster' as const,
      source: 'osm',
    },
  ],
};

const INTERACTIVE_LAYER_IDS = ['stops-circle', 'lines-line', 'trips-line'];

const STOP_LAYER: LayerSpecification = {
  id: 'stops-circle',
  type: 'circle',
  source: 'stops',
  paint: {
    'circle-radius': 4,
    'circle-color': '#e74c3c',
    'circle-stroke-color': '#fff',
    'circle-stroke-width': 1,
  },
};

const LINE_LAYER: LayerSpecification = {
  id: 'lines-line',
  type: 'line',
  source: 'lines',
  paint: {
    'line-color': '#3498db',
    'line-width': 2.5,
    'line-opacity': 0.8,
  },
};

const TRIP_LAYER: LayerSpecification = {
  id: 'trips-line',
  type: 'line',
  source: 'trips',
  paint: {
    'line-color': '#2ecc71',
    'line-width': 1.5,
    'line-opacity': 0.5,
  },
};

interface HoverInfo {
  properties: Record<string, unknown>;
  layerId: string;
}

const LAYER_LABELS: Record<string, string> = {
  'stops-circle': 'stop',
  'lines-line': 'line',
  'trips-line': 'trip',
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' && value.length > 120) return value.slice(0, 120) + '...';
  return String(value);
}

function computeBounds(layers: Record<string, FeatureCollection>): [number, number, number, number] | null {
  const allFeatures: Feature[] = [];
  for (const fc of Object.values(layers)) {
    allFeatures.push(...fc.features);
  }
  if (allFeatures.length === 0) return null;
  const merged = featureCollection(allFeatures);
  const [minLng, minLat, maxLng, maxLat] = bbox(merged);
  if (!isFinite(minLng) || !isFinite(minLat) || !isFinite(maxLng) || !isFinite(maxLat)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

export function MapPreview() {
  const generatedLayers = useAppStore(s => s.generatedLayers);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [pinnedInfo, setPinnedInfo] = useState<HoverInfo | null>(null);
  const mapRef = useRef<MapRef>(null);

  const stopsData = useMemo(() => generatedLayers.stops ?? null, [generatedLayers.stops]);
  const linesData = useMemo(() => generatedLayers.lines ?? null, [generatedLayers.lines]);
  const tripsData = useMemo(() => generatedLayers.trips ?? null, [generatedLayers.trips]);

  useEffect(() => {
    if (Object.keys(generatedLayers).length === 0) return;
    const bounds = computeBounds(generatedLayers);
    if (!bounds) return;
    const map = mapRef.current;
    if (!map) return;
    const [minLng, minLat, maxLng, maxLat] = bounds;
    map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 40, maxZoom: 16, duration: 800 },
    );
  }, [generatedLayers]);

  const onMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature || !feature.properties) {
      setHoverInfo(null);
      return;
    }
    setHoverInfo({
      properties: feature.properties as Record<string, unknown>,
      layerId: feature.layer.id,
    });
  }, []);

  const onMouseLeave = useCallback(() => {
    setHoverInfo(null);
  }, []);

  const onClick = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature || !feature.properties) {
      setPinnedInfo(null);
      return;
    }
    setPinnedInfo({
      properties: feature.properties as Record<string, unknown>,
      layerId: feature.layer.id,
    });
  }, []);

  const displayInfo = pinnedInfo ?? hoverInfo;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 139.7, latitude: 35.68, zoom: 10 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
        interactiveLayerIds={INTERACTIVE_LAYER_IDS}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        cursor={hoverInfo ? 'pointer' : ''}
      >
        {linesData && (
          <Source id="lines" type="geojson" data={linesData}>
            <Layer {...LINE_LAYER} />
          </Source>
        )}
        {tripsData && (
          <Source id="trips" type="geojson" data={tripsData}>
            <Layer {...TRIP_LAYER} />
          </Source>
        )}
        {stopsData && (
          <Source id="stops" type="geojson" data={stopsData}>
            <Layer {...STOP_LAYER} />
          </Source>
        )}
      </Map>
      {displayInfo && (
        <div className={`hover-panel${pinnedInfo ? ' pinned' : ''}`}>
          <div className="hover-panel-header">
            <span>{LAYER_LABELS[displayInfo.layerId] ?? displayInfo.layerId}</span>
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
    </div>
  );
}
