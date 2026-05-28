import { useEffect } from 'react';
import { useAppStore } from '../../store/app-store';
import { useT } from '../hooks/use-t';
import type { LayerType, StopsDissolvedGroupBy, LinesDissolvedGroupBy } from '../../gtfs/types';

type LayerDescKey =
  | 'layer.stops' | 'layer.lines' | 'layer.trips'
  | 'layer.stops-buffer' | 'layer.lines-buffer'
  | 'layer.stops-dissolved' | 'layer.lines-dissolved'
  | 'layer.envelope' | 'layer.convex' | 'layer.concave'
  | 'layer.segments'
  | 'layer.matching';

const LAYER_GROUPS: { group: string; layers: { id: LayerType; label: string; descKey: LayerDescKey }[] }[] = [
  {
    group: 'Basic',
    layers: [
      { id: 'stops', label: 'stops', descKey: 'layer.stops' },
      { id: 'lines', label: 'lines', descKey: 'layer.lines' },
      { id: 'trips', label: 'trips', descKey: 'layer.trips' },
      { id: 'segments', label: 'segments', descKey: 'layer.segments' },
    ],
  },
  {
    group: 'Buffer',
    layers: [
      { id: 'stops-buffer', label: 'stops-buffer', descKey: 'layer.stops-buffer' },
      { id: 'lines-buffer', label: 'lines-buffer', descKey: 'layer.lines-buffer' },
    ],
  },
  {
    group: 'Dissolved',
    layers: [
      { id: 'stops-dissolved', label: 'stops-dissolved', descKey: 'layer.stops-dissolved' },
      { id: 'lines-dissolved', label: 'lines-dissolved', descKey: 'layer.lines-dissolved' },
    ],
  },
  {
    group: 'Area',
    layers: [
      { id: 'envelope', label: 'envelope', descKey: 'layer.envelope' },
      { id: 'convex', label: 'convex', descKey: 'layer.convex' },
      { id: 'concave', label: 'concave', descKey: 'layer.concave' },
    ],
  },
  {
    group: 'Matching',
    layers: [
      { id: 'matching', label: 'matching', descKey: 'layer.matching' },
    ],
  },
];

const BUFFER_LAYERS: LayerType[] = ['stops-buffer', 'lines-buffer', 'stops-dissolved', 'lines-dissolved'];

const STOPS_DISSOLVED_GROUP_OPTIONS: { value: StopsDissolvedGroupBy; label: string }[] = [
  { value: 'none', label: '' },
  { value: 'agency_name', label: 'agency_name' },
  { value: 'route_id', label: 'route_id' },
];

const LINES_DISSOLVED_GROUP_OPTIONS: { value: LinesDissolvedGroupBy; label: string }[] = [
  { value: 'none', label: '' },
  { value: 'agency_id', label: 'agency_id' },
  { value: 'route_id', label: 'route_id' },
  { value: 'shape_id', label: 'shape_id' },
];

export function LayerSelector() {
  const { t } = useT();
  const selectedLayer = useAppStore(s => s.selectedLayer);
  const selectLayer = useAppStore(s => s.selectLayer);
  const tripsBaseDate = useAppStore(s => s.tripsBaseDate);
  const setTripsBaseDate = useAppStore(s => s.setTripsBaseDate);
  const tripsRouteFilter = useAppStore(s => s.tripsRouteFilter);
  const setTripsRouteFilter = useAppStore(s => s.setTripsRouteFilter);
  const bufferRadius = useAppStore(s => s.bufferRadius);
  const setBufferRadius = useAppStore(s => s.setBufferRadius);
  const concaveMaxEdge = useAppStore(s => s.concaveMaxEdge);
  const setConcaveMaxEdge = useAppStore(s => s.setConcaveMaxEdge);
  const stopsDissolvedGroupBy = useAppStore(s => s.stopsDissolvedGroupBy);
  const setStopsDissolvedGroupBy = useAppStore(s => s.setStopsDissolvedGroupBy);
  const linesDissolvedGroupBy = useAppStore(s => s.linesDissolvedGroupBy);
  const setLinesDissolvedGroupBy = useAppStore(s => s.setLinesDissolvedGroupBy);
  const hasShapes = useAppStore(s => s.gtfsSummary?.hasShapes ?? false);
  const phase = useAppStore(s => s.phase);
  const routeInfoList = useAppStore(s => s.routeInfoList);
  const routeStopsByRoute = useAppStore(s => s.routeStopsByRoute);
  const travelTimeTargets = useAppStore(s => s.travelTimeTargets);
  const setTravelTimeTarget = useAppStore(s => s.setTravelTimeTarget);
  const loadRouteStops = useAppStore(s => s.loadRouteStops);

  useEffect(() => {
    if (selectedLayer === 'stops' && (phase === 'loaded' || phase === 'done') && routeInfoList.length === 0) {
      loadRouteStops();
    }
  }, [selectedLayer, phase, routeInfoList.length, loadRouteStops]);

  return (
    <div>
      <select
        className="layer-select"
        value={selectedLayer}
        onChange={e => selectLayer(e.target.value as LayerType)}
      >
        {LAYER_GROUPS.map(group => (
          <optgroup key={group.group} label={group.group}>
            {group.layers.map(layer => (
              <option key={layer.id} value={layer.id}>
                {layer.label} — {t(layer.descKey)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {selectedLayer === 'trips' && (
        <>
          <div className="field" style={{ marginTop: 10 }}>
            <span className="field-label">{t('layer.baseDate')}</span>
            <input type="date" value={tripsBaseDate} onChange={e => setTripsBaseDate(e.target.value)} />
          </div>
          <div className="field">
            <span className="field-label">{t('layer.routeFilter')}</span>
            <input type="text" value={tripsRouteFilter} onChange={e => setTripsRouteFilter(e.target.value)} placeholder={t('layer.routePlaceholder')} />
          </div>
        </>
      )}

      {BUFFER_LAYERS.includes(selectedLayer) && (
        <div className="field" style={{ marginTop: 10 }}>
          <span className="field-label">{t('layer.bufferRadius')}</span>
          <input
            type="number"
            min={1}
            step={100}
            value={bufferRadius}
            onChange={e => setBufferRadius(Number(e.target.value))}
          />
        </div>
      )}

      {selectedLayer === 'stops-dissolved' && (
        <div className="field" style={{ marginTop: 10 }}>
          <span className="field-label">{t('layer.groupBy')}</span>
          <select
            className="layer-select"
            value={stopsDissolvedGroupBy}
            onChange={e => setStopsDissolvedGroupBy(e.target.value as StopsDissolvedGroupBy)}
          >
            {STOPS_DISSOLVED_GROUP_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.value === 'none' ? t('layer.groupNone') : opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedLayer === 'lines-dissolved' && (
        <div className="field" style={{ marginTop: 10 }}>
          <span className="field-label">{t('layer.groupBy')}</span>
          <select
            className="layer-select"
            value={linesDissolvedGroupBy}
            onChange={e => setLinesDissolvedGroupBy(e.target.value as LinesDissolvedGroupBy)}
          >
            {LINES_DISSOLVED_GROUP_OPTIONS
              .filter(opt => opt.value !== 'shape_id' || hasShapes)
              .map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.value === 'none' ? t('layer.groupNone') : opt.label}
                </option>
              ))}
          </select>
        </div>
      )}

      {selectedLayer === 'concave' && (
        <div className="field" style={{ marginTop: 10 }}>
          <span className="field-label">{t('layer.concaveMaxEdge')}</span>
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={concaveMaxEdge}
            onChange={e => setConcaveMaxEdge(Number(e.target.value))}
          />
        </div>
      )}

      {selectedLayer === 'stops' && routeInfoList.length > 0 && (
        <div className="field" style={{ marginTop: 10 }}>
          <span className="field-label">{t('layer.travelTimeTarget')}</span>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {routeInfoList.map(route => (
              <div key={route.route_id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, minWidth: 80, flexShrink: 0 }}>
                  {route.route_short_name || route.route_long_name || route.route_id}
                </span>
                <select
                  className="layer-select"
                  style={{ flex: 1, fontSize: 12 }}
                  value={travelTimeTargets[route.route_id] ?? ''}
                  onChange={e => setTravelTimeTarget(route.route_id, e.target.value)}
                >
                  <option value="">{t('layer.travelTimeNone')}</option>
                  {(routeStopsByRoute[route.route_id] ?? []).map(stop => (
                    <option key={stop.stop_id} value={stop.stop_id}>
                      {stop.stop_name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
