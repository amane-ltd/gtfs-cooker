import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppStore } from '../../store/app-store';
import { useT } from '../hooks/use-t';
import { ProgressBar } from './progress-bar';
import type { MappingType, MappingRow, RidershipFormat, RidershipFieldConfig, StopGtfsField, RouteGtfsField, AgencyGtfsField, CandidateGroup } from '../../ridership/types';
import type { MatchingOutputLayer } from '../../gtfs/types';

const SELECTABLE_FORMATS: { value: RidershipFormat; key: string }[] = [
  { value: 'commons-detail', key: 'ridership.fmt.commons-detail' },
  { value: 'detail', key: 'ridership.fmt.detail' },
  { value: 'stop-trip-detail', key: 'ridership.fmt.stop-trip-detail' },
  { value: 'od-aggregate', key: 'ridership.fmt.od-aggregate' },
  { value: 'station-aggregate', key: 'ridership.fmt.station-aggregate' },
  { value: 'route-aggregate', key: 'ridership.fmt.route-aggregate' },
];

type MatchingLayerDescKey =
  | 'layer.matching-stops' | 'layer.matching-lines' | 'layer.matching-segments'
  | 'layer.matching-flow' | 'layer.matching-od'
  | 'layer.matching-trips' | 'layer.matching-animation' | 'layer.matching-ridership';

const MATCHING_SUB_LAYERS: { id: MatchingOutputLayer; label: string; descKey: MatchingLayerDescKey }[] = [
  { id: 'matching-stops', label: 'matching-stops', descKey: 'layer.matching-stops' },
  { id: 'matching-lines', label: 'matching-lines', descKey: 'layer.matching-lines' },
  { id: 'matching-segments', label: 'matching-segments', descKey: 'layer.matching-segments' },
  { id: 'matching-flow', label: 'matching-flow', descKey: 'layer.matching-flow' },
  { id: 'matching-od', label: 'matching-od', descKey: 'layer.matching-od' },
  { id: 'matching-trips', label: 'matching-trips', descKey: 'layer.matching-trips' },
  { id: 'matching-animation', label: 'matching-animation', descKey: 'layer.matching-animation' },
  { id: 'matching-ridership', label: 'matching-ridership', descKey: 'layer.matching-ridership' },
];

// 時刻帯別 trip 列を持つサブレイヤー（「便時刻表示」トグルの対象）
const TRIP_COLUMN_SUBLAYERS = new Set<MatchingOutputLayer>([
  'matching-stops', 'matching-lines', 'matching-segments',
]);

function getAvailableMatchingLayers(fieldConfig: RidershipFieldConfig | null): Set<MatchingOutputLayer> {
  const available = new Set<MatchingOutputLayer>();
  if (!fieldConfig) return available;
  if (fieldConfig.boardingStopCol) available.add('matching-stops');
  if (fieldConfig.routeCol) available.add('matching-lines');
  const hasOD = fieldConfig.boardingStopCol && fieldConfig.alightingStopCol;
  const hasTripDetail = fieldConfig.boardingStopCol && fieldConfig.tripIdCol && fieldConfig.timeCol;
  if (hasOD) {
    available.add('matching-segments');
    available.add('matching-flow');
    available.add('matching-od');
  } else if (hasTripDetail) {
    available.add('matching-segments');
  }
  // matching-trips / matching-animation: OD（時刻列必須）or 停留所×便別実績
  if ((hasOD && fieldConfig.timeCol) || hasTripDetail) {
    available.add('matching-trips');
    available.add('matching-animation');
  }
  // matching-ridership: OD（時刻列必須）のみ。停留所×便別実績は OD リンクなしのため不可
  if (hasOD && fieldConfig.timeCol) {
    available.add('matching-ridership');
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
  /** 単一の乗降数列（countCols）。od-aggregate / route-aggregate / detail で使用 */
  count: boolean;
  tripDetail: boolean;
}

// ドキュメント（docs/user/ja/matching.md「フォーマット別の列設定方法」）の
// 必須/任意の列にあわせて、各フォーマットで表示する列だけを返す。
function getFieldVisibility(format: RidershipFormat): FieldVisibility {
  switch (format) {
    case 'commons-detail':
      // 乗降数は年齢区分の複数列（自動検出）のため単一 count セレクタは出さない
      return { boardingStop: true, alightingStop: true, route: true, agency: true, countOnOff: false, count: false, tripDetail: false };
    case 'detail':
      return { boardingStop: true, alightingStop: true, route: true, agency: true, countOnOff: false, count: true, tripDetail: false };
    case 'stop-trip-detail':
      return { boardingStop: true, alightingStop: false, route: true, agency: false, countOnOff: true, count: false, tripDetail: true };
    case 'od-aggregate':
      return { boardingStop: true, alightingStop: true, route: true, agency: true, countOnOff: false, count: true, tripDetail: false };
    case 'station-aggregate':
      // 停留所集計: 停留所列 + 乗車/降車数列 + 時刻列（任意）のみ。路線/事業者は使わない。
      return { boardingStop: true, alightingStop: false, route: false, agency: false, countOnOff: true, count: false, tripDetail: false };
    case 'route-aggregate':
      // 系統集計: 路線列 + 乗降数列 + 事業者列/時刻列（任意）。停留所は使わない。
      return { boardingStop: false, alightingStop: false, route: true, agency: true, countOnOff: false, count: true, tripDetail: false };
    default:
      return { boardingStop: true, alightingStop: true, route: true, agency: true, countOnOff: true, count: true, tripDetail: true };
  }
}

/** 折りたたみ可能なボックス（四角で囲む + ▼/▶ プルダウン）。 */
function CollapsibleBox({ title, defaultOpen = false, children }: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ridership-section">
      <div className="ridership-section-header" onClick={() => setOpen(!open)}>
        <span>{open ? '▼' : '▶'} {title}</span>
      </div>
      {open && <div className="ridership-section-body">{children}</div>}
    </div>
  );
}

/** 路線を複数選択で絞り込むチェックボックス・プルダウン。
 *  項目表記: route_id(route_short_name)。short が空なら route_id(route_long_name)。 */
function RouteMultiSelect() {
  const { t, tf } = useT();
  const phase = useAppStore(s => s.phase);
  const routeInfoList = useAppStore(s => s.routeInfoList);
  const loadRouteStops = useAppStore(s => s.loadRouteStops);
  const selected = useAppStore(s => s.matchingRouteFilterIds);
  const setSelected = useAppStore(s => s.setMatchingRouteFilterIds);
  const [open, setOpen] = useState(false);

  // matching レイヤーでも路線一覧が必要なので、未取得なら読み込む
  useEffect(() => {
    if ((phase === 'loaded' || phase === 'done') && routeInfoList.length === 0) loadRouteStops();
  }, [phase, routeInfoList.length, loadRouteStops]);

  const routeLabel = (r: { route_id: string; route_short_name: string | null; route_long_name: string | null }) => {
    const sub = r.route_short_name?.trim() ? r.route_short_name : (r.route_long_name?.trim() || '');
    return sub ? `${r.route_id}(${sub})` : r.route_id;
  };

  const selectedSet = new Set(selected);
  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected([...next]);
  };

  const summary = selected.length === 0
    ? t('ridership.routeFilterAll')
    : tf('ridership.routeFilterCount', selected.length);

  return (
    <div className="field" style={{ marginTop: 8 }}>
      <span className="field-label">{t('ridership.routeFilter')}</span>
      <div className="route-multiselect">
        <button type="button" className="route-multiselect-toggle" onClick={() => setOpen(o => !o)}>
          <span className="route-multiselect-summary">{summary}</span>
          <span>{open ? '▲' : '▼'}</span>
        </button>
        {open && (
          <div className="route-multiselect-menu">
            {selected.length > 0 && (
              <div className="route-multiselect-actions">
                <button type="button" onClick={() => setSelected([])}>
                  {t('ridership.routeFilterClear')}
                </button>
              </div>
            )}
            {routeInfoList.length === 0 && (
              <div className="route-multiselect-empty">—</div>
            )}
            {routeInfoList.map(r => (
              <label key={r.route_id} className="route-multiselect-item">
                <input
                  type="checkbox"
                  checked={selectedSet.has(r.route_id)}
                  onChange={() => toggle(r.route_id)}
                />
                <span>{routeLabel(r)}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 列設定の中身（3-1 ボックス内に直接描画。独自の折りたたみは持たない）。 */
function FieldConfigBody() {
  const { t } = useT();
  const columns = useAppStore(s => s.ridershipColumns);
  const fieldConfig = useAppStore(s => s.fieldConfig);
  const setFieldConfig = useAppStore(s => s.setFieldConfig);
  const format = useAppStore(s => s.ridershipSummary?.format ?? 'unknown');

  if (!fieldConfig) return null;

  const vis = getFieldVisibility(format);

  // 必須列にはアスタリスクを付ける（docs/user matching.md「フォーマット別の列設定」準拠）
  const routeRequired = format === 'stop-trip-detail' || format === 'route-aggregate';
  const timeRequired = format === 'stop-trip-detail';
  const star = (label: string, required: boolean) => (required ? `${label} *` : label);

  const update = (patch: Partial<RidershipFieldConfig>) => {
    setFieldConfig({ ...fieldConfig, ...patch });
  };

  return (
    <>
      <div className="field-config-heading">{t('ridership.fieldConfig')}</div>
          {(vis.boardingStop || vis.alightingStop) && (
            <div className="field-config-group">
              {vis.boardingStop && (
                <ColumnSelect
                  label={star(vis.alightingStop ? t('ridership.boardingStopCol') : t('ridership.stopCol'), true)}
                  value={fieldConfig.boardingStopCol}
                  columns={columns}
                  onChange={v => update({ boardingStopCol: v })}
                />
              )}
              {vis.alightingStop && (
                <ColumnSelect
                  label={star(t('ridership.alightingStopCol'), true)}
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
                label={star(t('ridership.routeCol'), routeRequired)}
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
                label={star(t('ridership.countOnCol'), true)}
                value={fieldConfig.countOnCol}
                columns={columns}
                onChange={v => update({ countOnCol: v })}
              />
              <ColumnSelect
                label={star(t('ridership.countOffCol'), true)}
                value={fieldConfig.countOffCol}
                columns={columns}
                onChange={v => update({ countOffCol: v })}
              />
            </div>
          )}

          {vis.count && (
            <div className="field-config-group">
              <ColumnSelect
                label={star(t('ridership.countCol'), true)}
                value={fieldConfig.countCols[0] ?? null}
                columns={columns}
                onChange={v => update({ countCols: v ? [v] : [] })}
              />
            </div>
          )}

          {vis.tripDetail && (
            <div className="field-config-group">
              <ColumnSelect
                label={star(t('ridership.tripIdCol'), true)}
                value={fieldConfig.tripIdCol}
                columns={columns}
                onChange={v => update({ tripIdCol: v })}
              />
              <ColumnSelect
                label={t('ridership.passThroughCol')}
                value={fieldConfig.passThroughCol}
                columns={columns}
                onChange={v => update({ passThroughCol: v })}
              />
            </div>
          )}

          <div className="field-config-group">
            <ColumnSelect
              label={t('ridership.dateCol')}
              value={fieldConfig.dateCol}
              columns={columns}
              onChange={v => update({ dateCol: v })}
            />
            <ColumnSelect
              label={star(t('ridership.timeCol'), timeRequired)}
              value={fieldConfig.timeCol}
              columns={columns}
              onChange={v => update({ timeCol: v })}
            />
          </div>
    </>
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
  stop: [
    'matching-stops', 'matching-segments', 'matching-flow', 'matching-od',
    'matching-animation', 'matching-ridership',
  ],
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

  // NOTE: Hooks must run unconditionally on every render. これらの useCallback は
  // 下の早期 return より前に置くこと（順番が変わると "Rendered more hooks..." で落ちる）。
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

  if (reconciliationMode === 'direct' || !hasColumn) return null;

  const isUpload = reconciliationMode === 'upload-mapping';
  const matched = rows.filter(r => r.gtfsIds.length > 0).length;

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
  const { t, tf } = useT();
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
  const tripAssignmentStats = useAppStore(s => s.tripAssignmentStats);
  const matchingOutputLayer = useAppStore(s => s.matchingOutputLayer);
  const setMatchingOutputLayer = useAppStore(s => s.setMatchingOutputLayer);
  const matchingShowRidershipPerTrip = useAppStore(s => s.matchingShowRidershipPerTrip);
  const setMatchingShowRidershipPerTrip = useAppStore(s => s.setMatchingShowRidershipPerTrip);
  const showTripTimes = useAppStore(s => s.showTripTimes);
  const setShowTripTimes = useAppStore(s => s.setShowTripTimes);
  const matchingJoinAllColumns = useAppStore(s => s.matchingJoinAllColumns);
  const setMatchingJoinAllColumns = useAppStore(s => s.setMatchingJoinAllColumns);
  const matchingOnlyMatched = useAppStore(s => s.matchingOnlyMatched);
  const setMatchingOnlyMatched = useAppStore(s => s.setMatchingOnlyMatched);
  const keyColumnDuplicates = useAppStore(s => s.keyColumnDuplicates);
  const checkKeyColumnDuplicates = useAppStore(s => s.checkKeyColumnDuplicates);

  const format = ridershipSummary?.format ?? 'unknown';
  const isAggregate = format === 'station-aggregate' || format === 'route-aggregate';
  const keyColForDup = format === 'station-aggregate' ? fieldConfig?.boardingStopCol : fieldConfig?.routeCol;
  useEffect(() => {
    checkKeyColumnDuplicates();
  }, [checkKeyColumnDuplicates, format, keyColForDup]);

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
          {/* (3-1) Format + field config — 既定で開く */}
          <CollapsibleBox title={`3-1 ${t('ridership.format')}`} defaultOpen>
            <div className="field" style={{ marginBottom: 8 }}>
              <select
                className="layer-select"
                value={ridershipSummary.format}
                onChange={e => setRidershipFormat(e.target.value as RidershipFormat)}
              >
                {ridershipSummary.format === 'unknown' && (
                  <option value="unknown" disabled>—</option>
                )}
                {SELECTABLE_FORMATS.map(f => (
                  <option key={f.value} value={f.value}>{t(f.key as never)}</option>
                ))}
              </select>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                {ridershipSummary.rowCount.toLocaleString()} rows
              </span>
            </div>
            <FieldConfigBody />
          </CollapsibleBox>

          {/* (3-2) Reconciliation mode — 既定で開く */}
          <CollapsibleBox title={`3-2 ${t('ridership.mode')}`} defaultOpen>
            <div className="field">
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
          </CollapsibleBox>

          {/* (3-3) Sub-layer selection + filters — 既定で開く */}
          <CollapsibleBox title={`3-3 ${t('ridership.subLayer')}`} defaultOpen>
            {availableMatching.size > 0 && (
              <div className="field">
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

            {/* Route filter（複数選択チェックボックス） */}
            <RouteMultiSelect />

            {/* Ridership per trip toggle */}
            <div className="field" style={{ marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <input
                  type="checkbox"
                  checked={matchingShowRidershipPerTrip}
                  onChange={e => setMatchingShowRidershipPerTrip(e.target.checked)}
                />
                {t('ridership.perTripToggle')}
              </label>
            </div>

            {/* Aggregate-only options: join all columns + only-matched */}
            {isAggregate && (
              <div className="field" style={{ marginTop: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <input
                    type="checkbox"
                    checked={matchingJoinAllColumns}
                    onChange={e => setMatchingJoinAllColumns(e.target.checked)}
                  />
                  {t('ridership.joinAllColumns')}
                </label>
                {keyColumnDuplicates && (
                  <div style={{ fontSize: 10, color: 'var(--color-warning)', marginTop: 4 }}>
                    {tf('ridership.dupWarning', keyColumnDuplicates.column, keyColumnDuplicates.count)}
                  </div>
                )}
              </div>
            )}

            {/* Only-matched output toggle */}
            {isAggregate && (
              <div className="field" style={{ marginTop: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <input
                    type="checkbox"
                    checked={matchingOnlyMatched}
                    onChange={e => setMatchingOnlyMatched(e.target.checked)}
                  />
                  {t('ridership.onlyMatched')}
                </label>
              </div>
            )}
          </CollapsibleBox>

          {/* (E) Join execution */}
          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
            <button className="btn btn-primary" onClick={executeJoin} style={{ flex: 1, fontSize: 10 }}>
              {t('ridership.join')}
            </button>
            <button className="btn btn-secondary" onClick={clearRidership} style={{ fontSize: 10 }}>
              {t('ridership.clear')}
            </button>
          </div>

          {/* 便数表示 → 便時刻表示トグル（trip 列を持つサブレイヤーのみ） */}
          {TRIP_COLUMN_SUBLAYERS.has(matchingOutputLayer) && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11 }}>
              <input
                type="checkbox"
                checked={showTripTimes}
                onChange={e => setShowTripTimes(e.target.checked)}
              />
              {t('layer.showTripTimes')}
            </label>
          )}

          {joinStats && (
            <dl className="summary" style={{ marginTop: 8 }}>
              <dt>{t('ridership.matched')}</dt><dd>{joinStats.matched}</dd>
              <dt>{t('ridership.unmatched')}</dt><dd>{joinStats.unmatched}</dd>
              <dt>{t('ridership.coverageStops')}</dt><dd>{joinStats.coverageStops}%</dd>
              <dt>{t('ridership.coverageRoutes')}</dt><dd>{joinStats.coverageRoutes}%</dd>
            </dl>
          )}

          {tripAssignmentStats && tripAssignmentStats.uniqueDates.length > 0 && (
            <FeedRangePanel stats={tripAssignmentStats} />
          )}
        </>
      )}
    </div>
  );
}

interface FeedRangePanelProps {
  stats: {
    assigned: number;
    inputRows: number;
    dropped: number;
    feedStartDate: string | null;
    feedEndDate: string | null;
    outOfFeedRange: number;
    uniqueDates: string[];
    outOfRangeDates: string[];
  };
}

function FeedRangePanel({ stats }: FeedRangePanelProps) {
  const { t } = useT();
  const dataStart = stats.uniqueDates[0]!;
  const dataEnd = stats.uniqueDates[stats.uniqueDates.length - 1]!;
  const hasFeedRange = !!(stats.feedStartDate && stats.feedEndDate);
  const isOutOfRange = stats.outOfFeedRange > 0;
  const hasDropped = stats.dropped > 0;
  const allInRange = hasFeedRange && !isOutOfRange && !hasDropped;
  const dropPct = stats.inputRows > 0
    ? Math.round((stats.dropped / stats.inputRows) * 100)
    : 0;
  return (
    <div className={`feed-range-panel ${allInRange ? 'ok' : (isOutOfRange || hasDropped) ? 'warn' : 'info'}`} style={{ marginTop: 8 }}>
      <div className="feed-range-title">
        {allInRange && '✓ '}
        {(isOutOfRange || hasDropped) && '⚠ '}
        {t('ridership.feedRange.title')}
      </div>
      <dl className="summary">
        <dt>{t('ridership.feedRange.dataPeriod')}</dt>
        <dd>{dataStart} 〜 {dataEnd} ({stats.uniqueDates.length} 日)</dd>
        {hasFeedRange && (
          <>
            <dt>{t('ridership.feedRange.feedPeriod')}</dt>
            <dd>{stats.feedStartDate} 〜 {stats.feedEndDate}</dd>
          </>
        )}
        <dt>{t('ridership.feedRange.input')}</dt>
        <dd>{stats.inputRows.toLocaleString()} 行</dd>
        <dt>{t('ridership.feedRange.assigned')}</dt>
        <dd>{stats.assigned.toLocaleString()} 行</dd>
        {hasDropped && (
          <>
            <dt className="feed-range-warn-key">{t('ridership.feedRange.dropped')}</dt>
            <dd className="feed-range-warn-val">{stats.dropped.toLocaleString()} 行 ({dropPct}%)</dd>
          </>
        )}
        {isOutOfRange && (
          <>
            <dt className="feed-range-warn-key">{t('ridership.feedRange.outOfRange')}</dt>
            <dd className="feed-range-warn-val">
              {stats.outOfFeedRange} 日
              {stats.outOfRangeDates.length > 0 && stats.outOfRangeDates.length <= 5 && (
                <> ({stats.outOfRangeDates.join(', ')})</>
              )}
            </dd>
          </>
        )}
      </dl>
      {!hasFeedRange && (
        <div className="feed-range-note">{t('ridership.feedRange.noFeedInfo')}</div>
      )}
      {(isOutOfRange || hasDropped) && (
        <div className="feed-range-note feed-range-warn-note">
          {t('ridership.feedRange.warnMessage')}
        </div>
      )}
    </div>
  );
}
