import { useAppStore } from '../../store/app-store';
import { useT } from '../hooks/use-t';
import { getAvailableProperties } from '../../gtfs/types';
import type { ExportFormat } from '../../store/app-store';

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'geojson', label: 'GeoJSON' },
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
];

export function PropertyPicker() {
  const { t } = useT();
  const selectedLayer = useAppStore(s => s.selectedLayer);
  const matchingOutputLayer = useAppStore(s => s.matchingOutputLayer);
  const selectedProperties = useAppStore(s => s.selectedProperties);
  const setSelectedProperties = useAppStore(s => s.setSelectedProperties);
  const exportFormat = useAppStore(s => s.exportFormat);
  const setExportFormat = useAppStore(s => s.setExportFormat);
  const matchingShowRidershipPerTrip = useAppStore(s => s.matchingShowRidershipPerTrip);

  const layer = selectedLayer === 'matching' ? matchingOutputLayer : selectedLayer;

  return (
    <div>
      <div className="field" style={{ marginBottom: 14 }}>
        <span className="field-label">{t('props.format')}</span>
        <div className="format-toggle">
          {FORMAT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`format-toggle-btn${exportFormat === opt.value ? ' active' : ''}`}
              onClick={() => setExportFormat(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {(() => {
        // 「便あたり乗車人数の列を追加」トグルと出力プロパティ一覧を一致させる。
        // トグル OFF のときは per-trip 列（生成側でも付与されない）を一覧から除外する。
        const available = matchingShowRidershipPerTrip
          ? getAvailableProperties(layer)
          : getAvailableProperties(layer).filter(p => !p.startsWith('ridership_per_trip'));
        const selected = selectedProperties[layer] ?? [];
        const selectedSet = new Set(selected);

        return (
          <div style={{ marginBottom: 12 }}>
            <div className="field-label" style={{ marginBottom: 4 }}>
              {layer}
              <button
                style={{ marginLeft: 8, fontSize: 10, cursor: 'pointer', border: 'none', background: 'none', color: 'var(--color-accent)' }}
                onClick={() => setSelectedProperties(layer, [...available])}
              >
                {t('props.selectAll')}
              </button>
              <button
                style={{ marginLeft: 4, fontSize: 10, cursor: 'pointer', border: 'none', background: 'none', color: 'var(--color-accent)' }}
                onClick={() => setSelectedProperties(layer, [])}
              >
                {t('props.clearAll')}
              </button>
            </div>
            <div className="property-list">
              <div className="checkbox-group">
                {available.map(prop => (
                  <label key={prop}>
                    <input
                      type="checkbox"
                      checked={selectedSet.has(prop)}
                      onChange={() => {
                        const next = selectedSet.has(prop)
                          ? selected.filter(p => p !== prop)
                          : [...selected, prop];
                        setSelectedProperties(layer, next);
                      }}
                    />
                    <span style={{ fontSize: 10 }}>{prop}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
