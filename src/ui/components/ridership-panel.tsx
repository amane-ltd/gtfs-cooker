import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { useT } from '../hooks/use-t';
import { ProgressBar } from './progress-bar';
import type { MappingType, MappingRow, RidershipFormat, RidershipFieldConfig, StopGtfsField, RouteGtfsField, AgencyGtfsField, CandidateGroup } from '../../ridership/types';
import type { MatchingOutputLayer } from '../../gtfs/types';

const SELECTABLE_FORMATS: { value: RidershipFormat; key: string }[] = [
  { value: 'detail', key: 'ridership.fmt.detail' },
  { value: 'stop-trip-detail', key: 'ridership.fmt.stop-trip-detail' },
  { value: 'od-aggregate', key: 'ridership.fmt.od-aggregate' },
  { value: 'station-aggregate', key: 'ridership.fmt.station-aggregate' },
  { value: 'route-aggregate', key: 'ridership.fmt.route-aggregate' },
];

type MatchingLayerDescKey =
  | 'layer.matching-stops' | 'layer.matching-lines' | 'layer.matching-segments'
  | 'layer.matching-flow' | 'layer.matching-od';

const MATCHING_SUB_LAYERS: { id: MatchingOutputLayer; label: string; descKey: MatchingLayerDescKey }[] = [
  { id: 'matching-stops', label: 'matching-stops', descKey: 'layer.matching-stops' },
  { id: 'matching-lines', label: 'matching-lines', descKey: 'layer.matching-lines' },
  { id: 'matching-segments', label: 'matching-segments', descKey: 'layer.matching-segments' },
  { id: 'matching-flow', label: 'matching-flow', descKey: 'layer.matching-flow' },
  { id: 'matching-od', label: 'matching-od', descKey: 'layer.matching-od' },
];

function getAvailableMatchingLayers(fieldConfig: RidershipFieldConfig | null): Set<MatchingOutputLayer> {
  const available = new Set<MatchingOutputLayer>();
  if (!fieldConfig) return available;
  if (fieldConfig.boardingStopCol) available.add('matching-stops');
  if (fieldConfig.routeCol) available.add('matching-lines');
  if (fieldConfig.boardingStopCol && fieldConfig.alightingStopCol) {
    available.add('matching-segments');
    available.add('matching-flow');
    available.add('matching-od');
  } else if (fieldConfig.boardingStopCol && fieldConfig.tripIdCol && fieldConfig.stopSequenceCol) {
    available.add('matching-segments');
  }
  return available;
}

const STATUS_COLORS: Record<string, string> = {
  'exact-id': 'var(--color-success)',
  'exact-name': 'var(--color-success)',
  'normalized': '#8BC34A',
  'partial': 'var(--color-warning)',
  'manual': 'var(--color-accent)',
  'unmatched': 'var(--color-error)',
  'skipped': 'var(--color-text-muted)',
};

function ColumnSelect({ label, value, columns, onChange }: {
  label: string;
  value: string | null;
  columns: string[];
  onChange: (v: string | null) => void;
}) {
  const { t } = useT();
  return (
    <div className="field-config-row">
      <span className="field-config-label">{label}</span>
      <select
        className="field-config-select"
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
      >
        <option value="">{t('ridership.notSet')}</option>
        {columns.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  );
}

function GtfsFieldSelect<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field-config-row">
      <span className="field-config-label">{label}</span>
      <select
        className="field-config-select"
        value={value}
        onChange={e => onChange(e.target.value as T)}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

interface FieldVisibility {
  boardingStop: boolean;
  alightingStop: boolean;
  route: boolean;
  agency: boolean;
  countOnOff: boolean;
  tripDetail: boolean;
}

function getFieldVisibility(format: RidershipFormat): FieldVisibility {
  switch (format) {
    case 'commons-detail':
    case 'detail':
      return { boardingStop: true, alightingStop: true, route: true, agency: true, countOnOff: false, tripDetail: false };
    case 'stop-trip-detail':
      return { boardingStop: true, alightingStop: false, route: true, agency: false, countOnOff: true, tripDetail: true };
    case 'od-aggregate':
      return { boardingStop: true, alightingStop: true, route: true, agency: true, countOnOff: false, tripDetail: false };
    case 'station-aggregate':
      return { boardingStop: true, alightingStop: false, route: true, agency: true, countOnOff: true, tripDetail: false };
    case 'route-aggregate':
      return { boardingStop: false, alightingStop: false, route: true, agency: true, countOnOff: false, tripDetail: false };
    default:
      return { boardingStop: true, alightingStop: true, route: true, agency: true, countOnOff: true, tripDetail: true };
  }
}

function FieldConfigPanel() {
  const { t } = useT();
  const columns = useAppStore(s => s.ridershipColumns);
  const fieldConfig = useAppStore(s => s.fieldConfig);
  const setFieldConfig = useAppStore(s => s.setFieldConfig);
  const format = useAppStore(s => s.ridershipSummary?.format ?? 'unknown');
  const [open, setOpen] = useState(false);

  if (!fieldConfig) return null;

  const vis = getFieldVisibility(format);

  const update = (patch: Partial<RidershipFieldConfig>) => {
    setFieldConfig({ ...fieldConfig, ...patch });
  };

  return (
    <div className="mapping-section">
      <div className="mapping-section-header" onClick={() => setOpen(!open)}>
        <span>{open ? '▼' : '▶'} {t('ridership.fieldConfig')}</span>
      </div>
      {open && (
        <div className="mapping-section-body">
          {(vis.boardingStop || vis.alightingStop) && (
            <div className="field-config-group">
              {vis.boardingStop && (
                <ColumnSelect
                  label={vis.alightingStop ? t('ridership.boardingStopCol') : t('ridership.stopCol')}
                  value={fieldConfig.boardingStopCol}
                  columns={columns}
                  onChange={v => update({ boardingStopCol: v })}
                />
              )}
              {vis.alightingStop && (
                <ColumnSelect
                  label={t('ridership.alightingStopCol')}
                  value={fieldConfig.alightingStopCol}
                  columns={columns}
                  onChange={v => update({ alightingStopCol: v })}
                />
              )}
              <GtfsFieldSelect<StopGtfsField>
                label={t('ridership.stopTarget')}
                value={fieldConfig.stopGtfsField}
                options={[
                  { value: 'stop_id', label: 'stop_id' },
                  { value: 'stop_name', label: 'stop_name' },
                ]}
                onChange={v => update({ stopGtfsField: v })}
              />
            </div>
          )}

          {vis.route && (
            <div className="field-config-group">
              <ColumnSelect
                label={t('ridership.routeCol')}
                value={fieldConfig.routeCol}
                columns={columns}
                onChange={v => update({ routeCol: v })}
              />
              <GtfsFieldSelect<RouteGtfsField>
                label={t('ridership.routeTarget')}
                value={fieldConfig.routeGtfsField}
                options={[
                  { value: 'route_id', label: 'route_id' },
                  { value: 'route_short_name', label: 'route_short_name' },
                  { value: 'route_long_name', label: 'route_long_name' },
                ]}
                onChange={v => update({ routeGtfsField: v })}
              />
            </div>
          )}

          {vis.agency && (
            <div className="field-config-group">
              <ColumnSelect
                label={t('ridership.agencyCol')}
                value={fieldConfig.agencyCol}
                columns={columns}
                onChange={v => update({ agencyCol: v })}
              />
              <GtfsFieldSelect<AgencyGtfsField>
                label={t('ridership.agencyTarget')}
                value={fieldConfig.agencyGtfsField}
                options={[
                  { value: 'agency_id', label: 'agency_id' },
                  { value: 'agency_name', label: 'agency_name' },
                ]}
                onChange={v => update({ agencyGtfsField: v })}
              />
            </div>
          )}

          {vis.countOnOff && (
            <div className="field-config-group">
              <ColumnSelect
                label={t('ridership.countOnCol')}
                value={fieldConfig.countOnCol}
                columns={columns}
                onChange={v => update({ countOnCol: v })}
              />
              <ColumnSelect
                label={t('ridership.countOffCol')}
                value={fieldConfig.countOffCol}
                columns={columns}
                onChange={v => update({ countOffCol: v })}
              />
            </div>
          )}

          {vis.tripDetail && (
            <div className="field-config-group">
              <ColumnSelect
                label={t('ridership.tripIdCol')}
                value={fieldConfig.tripIdCol}
                columns={columns}
                onChange={v => update({ tripIdCol: v })}
              />
              <ColumnSelect
                label={t('ridership.stopSequenceCol')}
                value={fieldConfig.stopSequenceCol}
                columns={columns}
                onChange={v => update({ stopSequenceCol: v })}
              />
              <ColumnSelect
                label={t('ridership.passThroughCol')}
                value={fieldConfig.passThroughCol}
                columns={columns}
                onChange={v => update({ passThroughCol: v })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatGtfsIds(ids: { id: string; name: string }[]): string {
  if (ids.length === 0) return '—';
  if (ids.length === 1) {
    const e = ids[0]!;
    return e.name && e.name !== e.id ? `${e.id} (${e.name})` : e.id;
  }
  const first = ids[0]!;
  const label = first.name && first.name !== first.id ? first.name : first.id;
  return `${label} +${ids.length - 1}`;
}

function selectedGroupId(row: MappingRow, allGroups: CandidateGroup[]): string {
  if (row.gtfsIds.length === 0) return '';
  const firstId = row.gtfsIds[0]!.id;
  for (const g of allGroups) {
    if (g.entries.some(e => e.id === firstId)) return g.groupId;
  }
  return firstId;
}

function groupOptionLabel(g: CandidateGroup): string {
  if (g.entries.length > 1) return `${g.groupName} (${g.entries.length})`;
  const e = g.entries[0];
  if (!e) return g.groupName;
  return e.id !== e.name ? `${e.id} (${e.name})` : e.id;
}

function MappingTable({ type, rows }: { type: MappingType; rows: MappingRow[] }) {
  const { t } = useT();
  const updateMappingRow = useAppStore(s => s.updateMappingRow);
  const allGroups = useAppStore(s => s.gtfsCandidates[type]);
  const [expanded, setExpanded] = useState(false);
  const display = expanded ? rows : rows.slice(0, 20);

  const usedGroupIds = useMemo(() => {
    const used = new Map<string, string>();
    for (const r of rows) {
      const gid = selectedGroupId(r, allGroups);
      if (gid) used.set(gid, r.odCode);
    }
    return used;
  }, [rows, allGroups]);

  return (
    <div className="mapping-table-wrap">
      <table className="mapping-table">
        <thead>
          <tr>
            <th>{t('ridership.odSide')}</th>
            <th>{t('ridership.gtfsSide')}</th>
            <th>{t('ridership.status')}</th>
          </tr>
        </thead>
        <tbody>
          {display.map(row => {
            const currentGid = selectedGroupId(row, allGroups);
            const options = allGroups.filter(g => {
              const owner = usedGroupIds.get(g.groupId);
              return !owner || owner === row.odCode;
            });
            const odLabel = row.odName && row.odName !== row.odCode ? `${row.odCode} (${row.odName})` : row.odCode;
            return (
              <tr key={row.odCode}>
                <td className="mapping-cell-od" title={odLabel}>
                  {odLabel}
                </td>
                <td>
                  {allGroups.length > 0 ? (
                    <select
                      className="mapping-select"
                      value={currentGid}
                      onChange={e => {
                        const gid = e.target.value;
                        if (!gid) { updateMappingRow(type, row.odCode, []); return; }
                        const group = allGroups.find(g => g.groupId === gid);
                        updateMappingRow(type, row.odCode, group ? group.entries : []);
                      }}
                    >
                      <option value="">—</option>
                      {options.map(g => (
                        <option key={g.groupId} value={g.groupId}>
                          {groupOptionLabel(g)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="mapping-cell-gtfs">
                      {formatGtfsIds(row.gtfsIds)}
                    </span>
                  )}
                </td>
                <td>
                  <span className="mapping-status" style={{ color: STATUS_COLORS[row.status] ?? 'inherit' }}>
                    {row.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 20 && !expanded && (
        <button className="mapping-show-more" onClick={() => setExpanded(true)}>
          +{rows.length - 20} more
        </button>
      )}
    </div>
  );
}

const MAPPING_SUBLAYERS: Record<MappingType, string[]> = {
  stop: ['matching-stops', 'matching-segments', 'matching-flow', 'matching-od'],
  route: ['matching-lines'],
  agency: [],
};

function MappingSection({ type, label, hasColumn }: { type: MappingType; label: string; hasColumn: boolean }) {
  const { t } = useT();
  const rows = useAppStore(s => s[`${type}Mapping`]);
  const startAutoMatch = useAppStore(s => s.startAutoMatch);
  const importMappingCsv = useAppStore(s => s.importMappingCsv);
  const reconciliationMode = useAppStore(s => s.reconciliationMode);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  if (reconciliationMode === 'direct' || !hasColumn) return null;

  const isUpload = reconciliationMode === 'upload-mapping';
  const matched = rows.filter(r => r.gtfsIds.length > 0).length;

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMappingCsv(type, file);
    if (fileRef.current) fileRef.current.value = '';
  }, [type, importMappingCsv]);

  const handleExport = useCallback(() => {
    const lines = ['od_value,gtfs_value'];
    for (const r of rows) {
      for (const g of r.gtfsIds) {
        const od = r.odCode.includes(',') ? `"${r.odCode}"` : r.odCode;
        const gtfs = g.id.includes(',') ? `"${g.id}"` : g.id;
        lines.push(`${od},${gtfs}`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}_mapping.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [type, rows]);

  return (
    <div className="mapping-section">
      <div className="mapping-section-header" onClick={() => setOpen(!open)}>
        <span>{open ? '▼' : '▶'} {label}</span>
        {rows.length > 0 && (
          <span className="mapping-badge">{matched}/{rows.length}</span>
        )}
      </div>
      {open && (
        <div className="mapping-section-body">
          {MAPPING_SUBLAYERS[type].length > 0 && (
            <div className="mapping-sublayers">
              → {MAPPING_SUBLAYERS[type].join(', ')}
            </div>
          )}
          {isUpload && (
            <div style={{ marginBottom: 4 }}>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ fontSize: 9, width: '100%' }} />
              <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {t('ridership.mappingCsvHint')}
              </div>
            </div>
          )}
          {rows.length > 0 && <MappingTable type={type} rows={rows} />}
          {rows.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              {!isUpload && (
                <button className="btn btn-secondary" onClick={() => startAutoMatch(type)} style={{ fontSize: 10 }}>
                  {t('ridership.reMatch')}
                </button>
              )}
              <button className="btn btn-secondary" onClick={handleExport} style={{ fontSize: 10 }}>
                {t('ridership.exportMapping')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RidershipPanel() {
  const { t } = useT();
  const phase = useAppStore(s => s.phase);
  const loadRidershipFile = useAppStore(s => s.loadRidershipFile);
  const loadExcelSheet = useAppStore(s => s.loadExcelSheet);
  const ridershipSummary = useAppStore(s => s.ridershipSummary);
  const setRidershipFormat = useAppStore(s => s.setRidershipFormat);
  const fieldConfig = useAppStore(s => s.fieldConfig);
  const reconciliationMode = useAppStore(s => s.reconciliationMode);
  const setReconciliationMode = useAppStore(s => s.setReconciliationMode);
  const excelSheets = useAppStore(s => s.excelSheets);
  const executeJoin = useAppStore(s => s.executeJoin);
  const clearRidership = useAppStore(s => s.clearRidership);
  const joinStats = useAppStore(s => s.joinStats);
  const matchingOutputLayer = useAppStore(s => s.matchingOutputLayer);
  const setMatchingOutputLayer = useAppStore(s => s.setMatchingOutputLayer);

  const progress = useAppStore(s => s.progress);
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.txt')) {
      loadRidershipFile(file);
    }
  }, [loadRidershipFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragover(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const isReady = phase === 'loaded' || phase === 'done';
  if (!isReady) return null;

  const availableMatching = getAvailableMatchingLayers(fieldConfig);

  return (
    <div>
      {/* (A) File upload */}
      {!ridershipSummary && !excelSheets && (
        <div
          className={`drop-zone drop-zone-sm${dragover ? ' dragover' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragover(true); }}
          onDragLeave={() => setDragover(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.txt"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <div>{t('ridership.drop')}</div>
          <div style={{ fontSize: 10, marginTop: 4 }}>{t('ridership.dropClick')}</div>
        </div>
      )}

      {progress && !ridershipSummary && (
        <ProgressBar value={progress.current} max={progress.total} label={progress.label} />
      )}

      {excelSheets && (
        <div className="field">
          <label className="field-label">{t('ridership.selectSheet')}</label>
          <select
            className="layer-select"
            onChange={e => { if (e.target.value) loadExcelSheet(e.target.value); }}
            defaultValue=""
          >
            <option value="" disabled>—</option>
            {excelSheets.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {ridershipSummary && (
        <>
          {/* (B) Format + field config */}
          <div className="field" style={{ marginBottom: 8 }}>
            <span className="field-label">{t('ridership.format')}</span>
            <select
              className="layer-select"
              value={ridershipSummary.format}
              onChange={e => setRidershipFormat(e.target.value as RidershipFormat)}
            >
              {ridershipSummary.format === 'unknown' && (
                <option value="unknown" disabled>—</option>
              )}
              {ridershipSummary.format === 'commons-detail' && (
                <option value="commons-detail">{t('ridership.fmt.commons-detail' as never)}</option>
              )}
              {SELECTABLE_FORMATS.map(f => (
                <option key={f.value} value={f.value}>{t(f.key as never)}</option>
              ))}
            </select>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              {ridershipSummary.rowCount.toLocaleString()} rows
            </span>
          </div>

          <FieldConfigPanel />

          {/* (C) Sub-layer selection */}
          {availableMatching.size > 0 && (
            <div className="field" style={{ marginTop: 8 }}>
              <span className="field-label">{t('ridership.subLayer')}</span>
              <select
                className="layer-select"
                value={matchingOutputLayer}
                onChange={e => setMatchingOutputLayer(e.target.value as MatchingOutputLayer)}
              >
                {MATCHING_SUB_LAYERS
                  .filter(sub => availableMatching.has(sub.id))
                  .map(sub => (
                    <option key={sub.id} value={sub.id}>
                      {sub.label} — {t(sub.descKey)}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* (D) Reconciliation */}
          <div className="field">
            <label className="field-label">{t('ridership.mode')}</label>
            <select
              className="layer-select"
              value={reconciliationMode}
              onChange={e => setReconciliationMode(e.target.value as 'direct' | 'auto-match' | 'upload-mapping')}
            >
              <option value="direct">{t('ridership.modeDirect')}</option>
              <option value="auto-match">{t('ridership.modeAuto')}</option>
              <option value="upload-mapping">{t('ridership.modeUpload')}</option>
            </select>
          </div>

          {reconciliationMode !== 'direct' && (
            <>
              <MappingSection type="stop" label={t('ridership.stopMapping')}
                hasColumn={!!(fieldConfig?.boardingStopCol || fieldConfig?.alightingStopCol)} />
              <MappingSection type="route" label={t('ridership.routeMapping')}
                hasColumn={!!fieldConfig?.routeCol} />
              <MappingSection type="agency" label={t('ridership.agencyMapping')}
                hasColumn={!!fieldConfig?.agencyCol} />
            </>
          )}

          {/* (E) Join execution */}
          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
            <button className="btn btn-primary" onClick={executeJoin} style={{ flex: 1, fontSize: 10 }}>
              {t('ridership.join')}
            </button>
            <button className="btn btn-secondary" onClick={clearRidership} style={{ fontSize: 10 }}>
              {t('ridership.clear')}
            </button>
          </div>

          {joinStats && (
            <dl className="summary" style={{ marginTop: 8 }}>
              <dt>{t('ridership.matched')}</dt><dd>{joinStats.matched}</dd>
              <dt>{t('ridership.unmatched')}</dt><dd>{joinStats.unmatched}</dd>
              <dt>{t('ridership.coverageStops')}</dt><dd>{joinStats.coverageStops}%</dd>
              <dt>{t('ridership.coverageRoutes')}</dt><dd>{joinStats.coverageRoutes}%</dd>
            </dl>
          )}
        </>
      )}
    </div>
  );
}
