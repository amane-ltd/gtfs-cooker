import { useAppStore } from '../../store/app-store';
import { useT } from '../hooks/use-t';
import type { LayerType } from '../../gtfs/types';

const LAYER_KEYS: { id: LayerType; label: string; descKey: 'layer.stops' | 'layer.lines' | 'layer.trips' }[] = [
  { id: 'stops', label: 'stops', descKey: 'layer.stops' },
  { id: 'lines', label: 'lines', descKey: 'layer.lines' },
  { id: 'trips', label: 'trips', descKey: 'layer.trips' },
];

export function LayerSelector() {
  const { t } = useT();
  const selectedLayer = useAppStore(s => s.selectedLayer);
  const selectLayer = useAppStore(s => s.selectLayer);
  const tripsBaseDate = useAppStore(s => s.tripsBaseDate);
  const setTripsBaseDate = useAppStore(s => s.setTripsBaseDate);
  const tripsRouteFilter = useAppStore(s => s.tripsRouteFilter);
  const setTripsRouteFilter = useAppStore(s => s.setTripsRouteFilter);

  return (
    <div>
      <div className="radio-group">
        {LAYER_KEYS.map(layer => (
          <label key={layer.id}>
            <input
              type="radio"
              name="layer"
              checked={selectedLayer === layer.id}
              onChange={() => selectLayer(layer.id)}
            />
            <span><strong>{layer.label}</strong> — {t(layer.descKey)}</span>
          </label>
        ))}
      </div>

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
    </div>
  );
}
