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
    group: 'Segment',
    layers: [
      { id: 'segments', label: 'segments', descKey: 'layer.segments' },
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

    </div>
  );
}
