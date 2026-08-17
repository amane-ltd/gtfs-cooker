import { create } from 'zustand';
import type { FeatureCollection } from 'geojson';
import type { GtfsSummary, ValidationResult, LogEntry, LayerType, MatchingOutputLayer, StopsDissolvedGroupBy, LinesDissolvedGroupBy, LinesFilterColumn } from '../gtfs/types';
import { getAvailableProperties } from '../gtfs/types';
import { getDb, resetDb } from '../db/init';
import { dropAllTables, loadCsvIntoTable, getTableRowCount, tableExists } from '../db/loader';
import { queryStops, queryShapePoints, queryRoutesWithShapes, queryTripsForDate, queryStopSequenceForRoute, querySegments, queryRouteStopLists, queryTravelTimesToStops } from '../db/queries';
import { buildStopsGeoJSON } from '../geojson/stops';
import { buildLinesGeoJSON } from '../geojson/lines';
import { buildTripsGeoJSON } from '../geojson/trips';
import { buildStopsBuffer, buildLinesBuffer } from '../geojson/buffer';
import { buildStopsDissolved, buildLinesDissolved } from '../geojson/dissolved';
import { buildEnvelope, buildConvexHull, buildConcaveHull } from '../geojson/area';
import { buildSegmentsGeoJSON } from '../geojson/segments';
import { makeFeatureCollection } from '../geojson/helpers';
import { detectAndDecode } from '../gtfs/encoding';
import { parseGtfsTime } from '../lib/time';
import { validateFiles, validateColumns } from '../gtfs/validator';
import { t, tf, getLanguage, setLanguage as setI18nLanguage } from '../i18n';
import type { Language } from '../i18n';
import JSZip from 'jszip';
import type { Feature } from 'geojson';
import type { RidershipSummary, ReconciliationMode, MappingRow, MappingType, JoinStats, RidershipFieldConfig, CandidateGroup } from '../ridership/types';
import { readRidershipFile, readExcelSheet, isExcelResult } from '../ridership/reader';
import { detectRidershipFormat } from '../ridership/detect-format';
import { autoMatch } from '../ridership/auto-match';
import { loadRidershipCsv, loadMappingRows, loadMappingCsv, dropRidershipTables } from '../db/ridership-loader';
import { defaultFieldConfig } from '../ridership/detect-format';
import { queryDistinctOdValues, queryGtfsStopGroups, queryGtfsRoutesForMatch, queryGtfsAgenciesForMatch, executeRidershipJoin, queryRidershipFlows, queryRidershipArcs, HOUR_KEYS, buildMatchingTripsTable, buildMatchingRidershipTable, queryMatchingTripSegments, queryMatchingRidership, queryTripAssignmentStats } from '../db/ridership-queries';
import type { RidershipArcRow, MatchingTripSegmentRow, MatchingRidershipRow, TripAssignmentStats } from '../db/ridership-queries';

export type Phase = 'idle' | 'loading' | 'loaded' | 'generating' | 'done';
export type ExportFormat = 'geojson' | 'csv' | 'xlsx';

/** アニメーション対象レイヤー。座標 4 要素目に unix 秒が入っているもの。 */
const ANIMATABLE_LAYERS: ReadonlySet<string> = new Set([
  'trips', 'matching-trips', 'matching-ridership',
]);

/** 生成済みレイヤーから unix 秒のレンジ (min, max) を抽出。 */
function computeTimeBounds(
  layers: Record<string, FeatureCollection>,
): { min: number; max: number } | null {
  let min = Infinity, max = -Infinity;
  for (const [key, fc] of Object.entries(layers)) {
    if (!ANIMATABLE_LAYERS.has(key)) continue;
    for (const f of fc.features) {
      const g = f.geometry;
      if (g.type !== 'LineString') continue;
      for (const c of g.coordinates as number[][]) {
        const t = c[3];
        if (typeof t === 'number' && Number.isFinite(t)) {
          if (t < min) min = t;
          if (t > max) max = t;
        }
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null;
  return { min, max };
}

const ALL_LAYERS: LayerType[] = [
  'stops', 'lines', 'trips',
  'stops-buffer', 'lines-buffer',
  'stops-dissolved', 'lines-dissolved',
  'envelope', 'convex', 'concave',
  'segments',
  'matching',
  'matching-stops', 'matching-lines', 'matching-segments',
  'matching-flow', 'matching-od',
  'matching-trips', 'matching-ridership',
];

interface AppState {
  language: Language;
  phase: Phase;
  gtfsSummary: GtfsSummary | null;
  validationResults: ValidationResult[];
  selectedLayer: LayerType;
  tripsBaseDate: string;
  tripsRouteFilter: string;
  bufferRadius: number;
  concaveMaxEdge: number;
  stopsDissolvedGroupBy: StopsDissolvedGroupBy;
  linesDissolvedGroupBy: LinesDissolvedGroupBy;
  /** lines / lines-dissolved の絞り込み対象列 */
  linesFilterColumn: LinesFilterColumn;
  /** 出力対象とする値のリスト（linesFilterColumn が指す列の値） */
  linesFilterValues: string[];
  /** lines レイヤーで値ごとに 1 フィーチャへ集約するか */
  linesFilterAggregate: boolean;
  selectedProperties: Record<LayerType, string[]>;
  exportFormat: ExportFormat;
  generatedLayers: Record<string, FeatureCollection>;
  logs: LogEntry[];
  progress: { current: number; total: number; label: string } | null;

  ridershipSummary: RidershipSummary | null;
  ridershipColumns: string[];
  fieldConfig: RidershipFieldConfig | null;
  reconciliationMode: ReconciliationMode;
  stopMapping: MappingRow[];
  routeMapping: MappingRow[];
  agencyMapping: MappingRow[];
  gtfsCandidates: Record<MappingType, CandidateGroup[]>;
  joinStats: JoinStats | null;
  /** matching-trips / matching-ridership 生成時の便割り当て統計と feed_info 整合性 */
  tripAssignmentStats: TripAssignmentStats | null;
  matchingOutputLayer: MatchingOutputLayer;
  matchingRouteFilterIds: string[];
  matchingShowRidershipPerTrip: boolean;
  /** true のとき stops/lines/segments の時刻帯別 trip 列を「分(便ID)」の便時刻表示にする */
  showTripTimes: boolean;
  /** 停留所集計/系統集計で、マッチした要素に CSV の全列を原値で付与する */
  matchingJoinAllColumns: boolean;
  /** マッチした停留所/系統のみを出力する（未マッチの GTFS 要素を除外） */
  matchingOnlyMatched: boolean;
  /** 停留所列/系統列に重複値がある場合の警告（なければ null） */
  keyColumnDuplicates: { column: string; count: number } | null;
  excelSheets: string[] | null;
  excelFile: File | null;
  is3D: boolean;

  // Time animation
  /** Current time in unix seconds (for animation of trips / matching-trips / matching-ridership) */
  currentTime: number;
  /** Min/max unix seconds across active animatable layers */
  timeBounds: { min: number; max: number } | null;
  /** Playback speed multiplier (1 real second = N simulated seconds) */
  playbackSpeed: number;
  isPlaying: boolean;
  /** TripsLayer trail length in seconds (kepler.gl "Trail Length") */
  trailLength: number;
  /** Whether to fade the trail (kepler.gl "Fade Trail") */
  fadeTrail: boolean;

  routeInfoList: Array<{ route_id: string; route_short_name: string | null; route_long_name: string | null }>;
  routeStopsByRoute: Record<string, Array<{ stop_id: string; stop_name: string }>>;
  travelTimeTargets: Record<string, string>;

  setIs3D: (v: boolean) => void;
  setLanguage: (lang: Language) => void;
  addLog: (level: LogEntry['level'], message: string) => void;
  setPhase: (phase: Phase) => void;
  selectLayer: (layer: LayerType) => void;
  setTripsBaseDate: (date: string) => void;
  setTripsRouteFilter: (filter: string) => void;
  setBufferRadius: (r: number) => void;
  setConcaveMaxEdge: (e: number) => void;
  setStopsDissolvedGroupBy: (g: StopsDissolvedGroupBy) => void;
  setLinesDissolvedGroupBy: (g: LinesDissolvedGroupBy) => void;
  setLinesFilterColumn: (c: LinesFilterColumn) => void;
  setLinesFilterValues: (v: string[]) => void;
  setLinesFilterAggregate: (v: boolean) => void;
  setMatchingOutputLayer: (layer: MatchingOutputLayer) => void;
  setMatchingRouteFilterIds: (ids: string[]) => void;
  setMatchingShowRidershipPerTrip: (v: boolean) => void;
  setShowTripTimes: (v: boolean) => void;
  setMatchingJoinAllColumns: (v: boolean) => void;
  setMatchingOnlyMatched: (v: boolean) => void;
  checkKeyColumnDuplicates: () => Promise<void>;

  setCurrentTime: (t: number) => void;
  setPlaybackSpeed: (s: number) => void;
  setIsPlaying: (v: boolean) => void;
  setTrailLength: (s: number) => void;
  setFadeTrail: (v: boolean) => void;
  setSelectedProperties: (layer: LayerType, props: string[]) => void;
  setExportFormat: (f: ExportFormat) => void;
  loadGtfsFile: (file: File) => Promise<void>;
  loadGtfsUrl: (url: string) => Promise<void>;
  generateLayers: () => Promise<void>;
  reset: () => void;

  loadRidershipFile: (file: File) => Promise<void>;
  loadExcelSheet: (sheetName: string) => Promise<void>;
  setRidershipFormat: (format: RidershipSummary['format']) => void;
  setReconciliationMode: (mode: ReconciliationMode) => void;
  setFieldConfig: (config: RidershipFieldConfig) => void;
  startAutoMatch: (type: MappingType) => Promise<void>;
  runAllAutoMatch: () => Promise<void>;
  updateMappingRow: (type: MappingType, odCode: string, gtfsIds: { id: string; name: string }[]) => void;
  confirmMapping: (type: MappingType) => Promise<void>;
  importMappingCsv: (type: MappingType, file: File) => Promise<void>;
  executeJoin: () => Promise<void>;
  clearRidership: () => Promise<void>;
  loadRouteStops: () => Promise<void>;
  setTravelTimeTarget: (routeId: string, stopId: string) => void;
  clearTravelTimeTargets: () => void;
}

const initialProperties = Object.fromEntries(
  ALL_LAYERS.map(l => [l, [...getAvailableProperties(l)]]),
) as Record<LayerType, string[]>;

export const useAppStore = create<AppState>((set, get) => ({
  language: getLanguage(),
  phase: 'idle',
  gtfsSummary: null,
  validationResults: [],
  selectedLayer: 'stops' as LayerType,
  tripsBaseDate: new Date().toISOString().slice(0, 10),
  tripsRouteFilter: '',
  bufferRadius: 300,
  concaveMaxEdge: 2,
  stopsDissolvedGroupBy: 'none' as StopsDissolvedGroupBy,
  linesDissolvedGroupBy: 'none' as LinesDissolvedGroupBy,
  linesFilterColumn: 'route_id' as LinesFilterColumn,
  linesFilterValues: [],
  linesFilterAggregate: false,
  selectedProperties: { ...initialProperties },
  exportFormat: 'geojson' as ExportFormat,
  generatedLayers: {},
  logs: [],
  progress: null,

  ridershipSummary: null,
  ridershipColumns: [],
  fieldConfig: null,
  reconciliationMode: 'auto-match' as ReconciliationMode,
  stopMapping: [],
  routeMapping: [],
  agencyMapping: [],
  gtfsCandidates: { stop: [], route: [], agency: [] },
  joinStats: null,
  tripAssignmentStats: null,
  matchingOutputLayer: 'matching-stops' as MatchingOutputLayer,
  matchingRouteFilterIds: [],
  matchingShowRidershipPerTrip: false,
  showTripTimes: false,
  matchingJoinAllColumns: false,
  matchingOnlyMatched: false,
  keyColumnDuplicates: null,
  excelSheets: null,
  excelFile: null,
  is3D: false,
  currentTime: 0,
  timeBounds: null,
  playbackSpeed: 600,
  isPlaying: false,
  trailLength: 600, // 10 minutes — kepler.gl-style default
  fadeTrail: true,
  routeInfoList: [],
  routeStopsByRoute: {},
  travelTimeTargets: {},

  setIs3D: (v) => set({ is3D: v }),
  setMatchingOutputLayer: (layer) => set({ matchingOutputLayer: layer }),
  setMatchingRouteFilterIds: (ids) => set({ matchingRouteFilterIds: ids }),
  setMatchingShowRidershipPerTrip: (v) => set({ matchingShowRidershipPerTrip: v }),
  setShowTripTimes: (v) => set({ showTripTimes: v }),
  setMatchingJoinAllColumns: (v) => set({ matchingJoinAllColumns: v }),
  setMatchingOnlyMatched: (v) => set({ matchingOnlyMatched: v }),

  checkKeyColumnDuplicates: async () => {
    const { fieldConfig, ridershipSummary } = get();
    const fmt = ridershipSummary?.format;
    if (!fieldConfig || (fmt !== 'station-aggregate' && fmt !== 'route-aggregate')) {
      set({ keyColumnDuplicates: null });
      return;
    }
    const col = fmt === 'station-aggregate' ? fieldConfig.boardingStopCol : fieldConfig.routeCol;
    if (!col) { set({ keyColumnDuplicates: null }); return; }
    const q = `"${col.replace(/"/g, '""')}"`;
    try {
      const db = await getDb();
      const conn = await db.connect();
      try {
        const res = await conn.query(
          `SELECT COUNT(*) AS dupvals FROM (
             SELECT ${q} FROM ridership
             WHERE ${q} IS NOT NULL AND CAST(${q} AS VARCHAR) != ''
             GROUP BY ${q} HAVING COUNT(*) > 1
           )`,
        );
        const n = Number((res.toArray()[0]?.toJSON() as { dupvals?: unknown })?.dupvals ?? 0);
        set({ keyColumnDuplicates: n > 0 ? { column: col, count: n } : null });
      } finally {
        await conn.close();
      }
    } catch {
      set({ keyColumnDuplicates: null });
    }
  },

  setCurrentTime: (t) => set({ currentTime: t }),
  setPlaybackSpeed: (s) => set({ playbackSpeed: s }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setTrailLength: (s) => set({ trailLength: s }),
  setFadeTrail: (v) => set({ fadeTrail: v }),

  setLanguage: (lang) => {
    setI18nLanguage(lang);
    set({ language: lang });
  },

  addLog: (level, message) =>
    set(s => ({ logs: [...s.logs, { timestamp: Date.now(), level, message }] })),

  setPhase: (phase) => set({ phase }),

  selectLayer: (layer) => set({ selectedLayer: layer }),

  setTripsBaseDate: (date) => set({ tripsBaseDate: date }),
  setTripsRouteFilter: (filter) => set({ tripsRouteFilter: filter }),
  setBufferRadius: (r) => set({ bufferRadius: r }),
  setConcaveMaxEdge: (e) => set({ concaveMaxEdge: e }),
  setStopsDissolvedGroupBy: (g) => set({ stopsDissolvedGroupBy: g }),
  setLinesDissolvedGroupBy: (g) => set({ linesDissolvedGroupBy: g }),
  // 列を変えたら選択値はリセット
  setLinesFilterColumn: (c) => set({ linesFilterColumn: c, linesFilterValues: [] }),
  setLinesFilterValues: (v) => set({ linesFilterValues: v }),
  setLinesFilterAggregate: (v) => set({ linesFilterAggregate: v }),

  setSelectedProperties: (layer, props) =>
    set(s => ({ selectedProperties: { ...s.selectedProperties, [layer]: props } })),

  setExportFormat: (f) => set({ exportFormat: f }),

  loadGtfsFile: async (file: File) => {
    const { addLog, phase } = get();
    if (phase !== 'loading') {
      set({ phase: 'loading', validationResults: [], logs: [], generatedLayers: {}, gtfsSummary: null });
    }
    addLog('info', tf('log.fileStart', file.name));

    try {
      const db = await getDb();
      await dropAllTables(db);

      const zip = await JSZip.loadAsync(file);
      const txtFiles = Object.keys(zip.files).filter(
        name => name.endsWith('.txt') && !name.startsWith('__MACOSX') && !name.includes('/.')
      );

      const baseNames = txtFiles.map(f => {
        const parts = f.split('/');
        return parts[parts.length - 1]!;
      });

      const fileValidation = validateFiles(baseNames);
      set(s => ({ validationResults: [...s.validationResults, ...fileValidation] }));

      if (fileValidation.some(v => v.level === 'error')) {
        addLog('error', t('log.validationError'));
      }

      const total = txtFiles.length;
      let current = 0;
      const loadedFiles: string[] = [];

      for (const path of txtFiles) {
        const baseName = path.split('/').pop()!;
        set({ progress: { current, total, label: tf('log.loadingFile', baseName) } });
        addLog('info', tf('log.processingFile', baseName));

        try {
          const arrayBuffer = await zip.files[path]!.async('arraybuffer');
          const csvText = detectAndDecode(arrayBuffer);

          const firstLine = csvText.split('\n')[0] ?? '';
          const colValidation = validateColumns(baseName, firstLine);
          set(s => ({ validationResults: [...s.validationResults, ...colValidation] }));

          const tableName = await loadCsvIntoTable(db, baseName, csvText);
          if (tableName) {
            const count = await getTableRowCount(db, tableName);
            addLog('info', tf('log.tableRows', tableName, count.toLocaleString()));
            loadedFiles.push(baseName);
          }
        } catch (e) {
          addLog('warn', tf('log.skipFile', baseName, e instanceof Error ? e.message : String(e)));
        }
        current++;
      }

      set({ progress: null });

      const hasShapes = await tableExists(db, 'shapes');
      const hasCalendar = await tableExists(db, 'calendar');
      const hasCalendarDates = await tableExists(db, 'calendar_dates');

      let agencyNames: string[] = [];
      let routeCount = 0;
      let stopCount = 0;
      let tripCount = 0;

      const conn = await db.connect();
      try {
        if (await tableExists(db, 'agency')) {
          const r = await conn.query(`SELECT agency_name FROM agency`);
          agencyNames = r.toArray().map(row => String((row.toJSON() as { agency_name: string }).agency_name));
        }
        if (await tableExists(db, 'routes')) {
          routeCount = Number((await conn.query(`SELECT COUNT(*) as c FROM routes`)).toArray()[0]?.c ?? 0);
        }
        if (await tableExists(db, 'stops')) {
          stopCount = Number((await conn.query(`SELECT COUNT(*) as c FROM stops`)).toArray()[0]?.c ?? 0);
        }
        if (await tableExists(db, 'trips')) {
          tripCount = Number((await conn.query(`SELECT COUNT(*) as c FROM trips`)).toArray()[0]?.c ?? 0);
        }
      } finally {
        await conn.close();
      }

      const summary: GtfsSummary = {
        agencyNames,
        routeCount,
        stopCount,
        tripCount,
        hasShapes,
        hasCalendar,
        hasCalendarDates,
        loadedFiles,
      };

      let baseDate = new Date().toISOString().slice(0, 10);
      if (hasCalendar) {
        const cConn = await db.connect();
        try {
          const res = await cConn.query(
            `SELECT MIN(CAST(start_date AS VARCHAR)) AS sd, MAX(CAST(end_date AS VARCHAR)) AS ed FROM calendar`
          );
          const row = res.toArray()[0]?.toJSON() as Record<string, unknown> | undefined;
          if (row?.sd && row?.ed) {
            const today = baseDate.replace(/-/g, '');
            const sd = String(row.sd);
            const ed = String(row.ed);
            if (today < sd) {
              baseDate = `${sd.slice(0, 4)}-${sd.slice(4, 6)}-${sd.slice(6, 8)}`;
            } else if (today > ed) {
              baseDate = `${ed.slice(0, 4)}-${ed.slice(4, 6)}-${ed.slice(6, 8)}`;
            }
          }
        } finally {
          await cConn.close();
        }
      }

      set({ gtfsSummary: summary, phase: 'loaded', tripsBaseDate: baseDate });
      addLog('info', tf('log.loadComplete', stopCount, routeCount, tripCount));
    } catch (e) {
      addLog('error', tf('log.loadError', e instanceof Error ? e.message : String(e)));
      set({ phase: 'idle', progress: null });
    }
  },

  loadGtfsUrl: async (url: string) => {
    const { addLog } = get();
    set({ phase: 'loading', validationResults: [], logs: [], generatedLayers: {}, gtfsSummary: null });
    addLog('info', tf('log.downloadStart', url));

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      const filename = url.split('/').pop()?.split('?')[0] || 'gtfs.zip';
      const file = new File([blob], filename, { type: 'application/zip' });
      addLog('info', tf('log.downloadDone', filename, (blob.size / 1024 / 1024).toFixed(1)));
      await get().loadGtfsFile(file);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog('error', tf('log.urlError', msg));
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        addLog('error', t('log.corsError'));
      }
      set({ phase: 'idle', progress: null });
    }
  },

  generateLayers: async () => {
    const state = get();
    const { addLog, selectedLayer } = state;
    const coordinatePrecision = 6;
    set({ phase: 'generating', generatedLayers: {} });

    try {
      const db = await getDb();
      const results: Record<string, FeatureCollection> = {};
      const layer = selectedLayer === 'matching' ? state.matchingOutputLayer : selectedLayer;

      set({ progress: { current: 0, total: 1, label: tf('log.generating', layer) } });
      addLog('info', tf('log.generating', layer));

      const props = state.selectedProperties[layer] ?? [];
      const agencyName = state.gtfsSummary?.agencyNames[0] ?? null;

      async function getLinesFC(opts?: { aggregate?: boolean }) {
        const routes = await queryRoutesWithShapes(db, state.showTripTimes);
        const hasShapes = await tableExists(db, 'shapes');
        let shapePoints: import('../db/queries').ShapePoint[] = [];
        if (hasShapes) {
          shapePoints = await queryShapePoints(db);
        }
        const fallbackStops = new Map<string, Array<{ stop_lat: number; stop_lon: number }>>();
        const coveredRouteIds = new Set<string>();
        if (shapePoints.length > 0) {
          const shapeIdSet = new Set(shapePoints.map(p => p.shape_id));
          for (const route of routes) {
            if ((route.shape_ids ?? []).some(sid => shapeIdSet.has(sid))) {
              coveredRouteIds.add(String(route.route_id));
            }
          }
        }
        for (const route of routes) {
          if (coveredRouteIds.has(String(route.route_id))) continue;
          const stops = await queryStopSequenceForRoute(db, String(route.route_id));
          if (stops.length >= 2) {
            fallbackStops.set(String(route.route_id), stops);
          }
        }
        return buildLinesGeoJSON(
          routes, shapePoints, [...getAvailableProperties('lines')], coordinatePrecision, fallbackStops,
          {
            column: state.linesFilterColumn,
            values: state.linesFilterValues,
            aggregate: opts?.aggregate ?? false,
          },
        );
      }

      // segment / matching-segment を shape.txt に追従させるための shape 座標マップ
      async function getSegmentShapes(): Promise<Map<string, import('../geojson/segments').ShapeGeometry>> {
        const map = new Map<string, import('../geojson/segments').ShapeGeometry>();
        if (!(await tableExists(db, 'shapes'))) return map;
        const pts = await queryShapePoints(db);
        for (const p of pts) {
          let e = map.get(p.shape_id);
          if (!e) { e = { coords: [] }; map.set(p.shape_id, e); }
          e.coords.push([p.shape_pt_lon, p.shape_pt_lat]);
        }
        return map;
      }

      const hasRidershipStops = await tableExists(db, 'ridership_by_stop');
      const hasRidershipRoutes = await tableExists(db, 'ridership_by_route');
      const hasRidershipSegments = await tableExists(db, 'ridership_by_segment');
      const rFieldConfig = state.fieldConfig;
      const showRatio = state.matchingShowRidershipPerTrip;

      const hourlyCols = HOUR_KEYS.map(k => `ridership_${k}`);

      function extractHourly(o: Record<string, unknown>): Record<string, number> {
        const out: Record<string, number> = {};
        for (const c of hourlyCols) {
          if (o[c] !== undefined && o[c] !== null) out[c] = Number(o[c]);
        }
        return out;
      }

      const round3 = (x: number): number => Math.round(x * 1000) / 1000;

      function attachRatioCols(
        target: Record<string, unknown>,
        ridership: number | undefined,
        hourly: Record<string, number>,
      ): void {
        if (!showRatio) return;
        const tripTotal = Number(target['trip_weekday'] ?? 0) + Number(target['trip_holiday'] ?? 0);
        target['ridership_per_trip'] = ridership !== undefined && tripTotal > 0
          ? round3(ridership / tripTotal)
          : null;
        for (const k of HOUR_KEYS) {
          const r = hourly[`ridership_${k}`];
          const t = Number(target[`trip_${k}`] ?? 0);
          target[`ridership_per_trip_${k}`] = r !== undefined && t > 0
            ? round3(r / t)
            : null;
        }
      }

      // 「すべてのカラムを結合する」用: allcols テーブルを読み、キー値→CSV 全列 の Map を返す。
      // 内部キー列（__gtfs_stop_val など）は除去する。テーブルが無ければ null。
      async function loadAllCols(
        conn2: Awaited<ReturnType<typeof db.connect>>,
        table: string,
        keyCol: string,
      ): Promise<Map<string, Record<string, unknown>> | null> {
        if (!(await tableExists(db, table))) return null;
        const res = await conn2.query(`SELECT * FROM ${table}`);
        const m = new Map<string, Record<string, unknown>>();
        for (const row of res.toArray()) {
          const o = row.toJSON() as Record<string, unknown>;
          const key = String(o[keyCol] ?? '');
          const rec: Record<string, unknown> = {};
          for (const k of Object.keys(o)) {
            if (k === keyCol) continue;
            rec[k] = typeof o[k] === 'bigint' ? Number(o[k]) : o[k];
          }
          m.set(key, rec);
        }
        return m;
      }

      async function enrichStopsWithRidership(fc: FeatureCollection) {
        if (!hasRidershipStops) return fc;
        const conn2 = await db.connect();
        try {
          const res = await conn2.query(`SELECT * FROM ridership_by_stop`);
          const map = new Map<string, { count_on: number; count_off: number; hourly: Record<string, number> }>();
          for (const row of res.toArray()) {
            const o = row.toJSON() as Record<string, unknown>;
            map.set(String(o.gtfs_stop_val), {
              count_on: Number(o.count_on ?? 0),
              count_off: Number(o.count_off ?? 0),
              hourly: extractHourly(o),
            });
          }
          // 「すべてのカラムを結合する」: CSV 行の全列（先頭行）を GTFS 停留所値ごとに取得
          const allCols = state.matchingJoinAllColumns
            ? await loadAllCols(conn2, 'ridership_allcols_by_stop', '__gtfs_stop_val')
            : null;
          // 全カラム結合時、乗車数/降車数の列が未指定なら集計列（ridership_on/off 等）は
          // 出さず、CSV 元列だけを残す（元のカラム名を踏襲）。
          const emitCounts = !state.matchingJoinAllColumns
            || !!(rFieldConfig?.countOnCol || rFieldConfig?.countOffCol);
          const matchProp = rFieldConfig?.stopGtfsField ?? 'stop_name';
          const matched: typeof fc.features = [];
          for (const feat of fc.features) {
            const sid = String(feat.properties?.[matchProp] ?? '');
            const r = map.get(sid);
            if (r) {
              // allCols を先に展開し、GTFS プロパティで上書き（列名衝突時は GTFS を優先）
              const props: Record<string, unknown> = { ...(allCols?.get(sid) ?? {}), ...feat.properties };
              if (emitCounts) {
                props.ridership_on = r.count_on;
                props.ridership_off = r.count_off;
                Object.assign(props, r.hourly);
                attachRatioCols(props, r.count_on + r.count_off, r.hourly);
              }
              feat.properties = props;
              matched.push(feat);
            }
          }
          if (state.matchingOnlyMatched) fc.features = matched;
        } finally {
          await conn2.close();
        }
        return fc;
      }

      async function enrichRoutesWithRidership(fc: FeatureCollection) {
        if (!hasRidershipRoutes) return fc;
        const conn2 = await db.connect();
        try {
          const res = await conn2.query(`SELECT * FROM ridership_by_route`);
          const map = new Map<string, { count: number; hourly: Record<string, number> }>();
          for (const row of res.toArray()) {
            const o = row.toJSON() as Record<string, unknown>;
            map.set(String(o.gtfs_route_val), {
              count: Number(o.ridership_count ?? 0),
              hourly: extractHourly(o),
            });
          }
          const allCols = state.matchingJoinAllColumns
            ? await loadAllCols(conn2, 'ridership_allcols_by_route', '__gtfs_route_val')
            : null;
          // 全カラム結合時、乗降数の列が未指定なら集計列（ridership_count 等）は出さない。
          const emitCounts = !state.matchingJoinAllColumns
            || (rFieldConfig?.countCols?.length ?? 0) > 0;
          const matchProp = rFieldConfig?.routeGtfsField ?? 'route_long_name';
          const matched: typeof fc.features = [];
          for (const feat of fc.features) {
            const rid = String(feat.properties?.[matchProp] ?? '');
            const entry = map.get(rid);
            if (entry !== undefined) {
              const props: Record<string, unknown> = { ...(allCols?.get(rid) ?? {}), ...feat.properties };
              if (emitCounts) {
                props.ridership_count = entry.count;
                Object.assign(props, entry.hourly);
                attachRatioCols(props, entry.count, entry.hourly);
              }
              feat.properties = props;
              matched.push(feat);
            }
          }
          if (state.matchingOnlyMatched) fc.features = matched;
        } finally {
          await conn2.close();
        }
        return fc;
      }

      async function enrichSegmentsWithRidership(fc: FeatureCollection) {
        if (!hasRidershipSegments) return fc;
        const conn2 = await db.connect();
        try {
          const res = await conn2.query(`SELECT * FROM ridership_by_segment`);
          const map = new Map<string, { riders: number; hourly: Record<string, number> }>();
          for (const row of res.toArray()) {
            const o = row.toJSON() as Record<string, unknown>;
            map.set(`${o.from_stop_val}->${o.to_stop_val}`, {
              riders: Number(o.riders ?? 0),
              hourly: extractHourly(o),
            });
          }
          const matchProp = rFieldConfig?.stopGtfsField === 'stop_name' ? 'from_stop_name' : 'from_stop_id';
          const matchProp2 = rFieldConfig?.stopGtfsField === 'stop_name' ? 'to_stop_name' : 'to_stop_id';
          const matched: typeof fc.features = [];
          for (const feat of fc.features) {
            const key = `${feat.properties?.[matchProp]}->${feat.properties?.[matchProp2]}`;
            const entry = map.get(key);
            if (entry !== undefined) {
              const props = { ...feat.properties, ridership: entry.riders, ...entry.hourly };
              attachRatioCols(props, entry.riders, entry.hourly);
              feat.properties = props;
              matched.push(feat);
            }
          }
          if (state.matchingOnlyMatched) fc.features = matched;
        } finally {
          await conn2.close();
        }
        return fc;
      }

      if (layer === 'stops') {
        const rows = await queryStops(db, state.showTripTimes);
        results.stops = buildStopsGeoJSON(rows, props, coordinatePrecision);
        const travelTimeMap = await queryTravelTimesToStops(db, state.travelTimeTargets);
        for (const feat of results.stops.features) {
          const stopId = String(feat.properties?.stop_id ?? '');
          const entry = travelTimeMap[stopId];
          if (entry) {
            feat.properties = {
              ...feat.properties,
              travel_time_min: entry.travel_time_min,
              travel_time_route_name: entry.route_name,
              travel_time_target_stop: entry.target_stop_name,
            };
          }
        }
        await enrichStopsWithRidership(results.stops);
        addLog('info', tf('log.features', 'stops', results.stops.features.length));
      }

      if (layer === 'lines') {
        results.lines = await getLinesFC({ aggregate: state.linesFilterAggregate });
        await enrichRoutesWithRidership(results.lines);
        addLog('info', tf('log.features', 'lines', results.lines.features.length));
      }

      if (layer === 'trips') {
        if (!state.tripsBaseDate) {
          addLog('warn', t('log.noBaseDate'));
        } else {
          const stopTimes = await queryTripsForDate(
            db, state.tripsBaseDate, state.tripsRouteFilter || undefined,
          );
          const hasShapesForTrips = await tableExists(db, 'shapes');
          const tripShapePoints = hasShapesForTrips ? await queryShapePoints(db) : [];
          results.trips = buildTripsGeoJSON(stopTimes, state.tripsBaseDate, props, coordinatePrecision, tripShapePoints);
          addLog('info', tf('log.features', 'trips', results.trips.features.length));
        }
      }

      if (layer === 'stops-buffer') {
        const rows = await queryStops(db, state.showTripTimes);
        const stopsFC = buildStopsGeoJSON(rows, [...getAvailableProperties('stops')], coordinatePrecision);
        results['stops-buffer'] = buildStopsBuffer(stopsFC, state.bufferRadius);
        addLog('info', tf('log.features', 'stops-buffer', results['stops-buffer'].features.length));
      }

      if (layer === 'lines-buffer') {
        const linesFC = await getLinesFC();
        results['lines-buffer'] = buildLinesBuffer(linesFC, state.bufferRadius);
        addLog('info', tf('log.features', 'lines-buffer', results['lines-buffer'].features.length));
      }

      if (layer === 'stops-dissolved') {
        const groupBy = state.stopsDissolvedGroupBy;
        const rows = await queryStops(db, state.showTripTimes);
        const stopsFC = buildStopsGeoJSON(rows, [...getAvailableProperties('stops')], coordinatePrecision);
        const listKey = groupBy === 'route_id' ? 'routes' : undefined;
        const dissolvedFC = buildStopsDissolved(
          stopsFC, state.bufferRadius, { agency_name: agencyName },
          groupBy === 'none' ? undefined : groupBy, listKey,
        );
        results['stops-dissolved'] = dissolvedFC;
        addLog('info', tf('log.features', 'stops-dissolved', dissolvedFC.features.length));
      }

      if (layer === 'lines-dissolved') {
        const groupBy = state.linesDissolvedGroupBy;
        let dissolvedFC: FeatureCollection;

        if (groupBy === 'shape_id' && state.gtfsSummary?.hasShapes) {
          const shapePoints = await queryShapePoints(db);
          const byShape = new Map<string, import('../db/queries').ShapePoint[]>();
          for (const pt of shapePoints) {
            const sid = String(pt.shape_id);
            if (!byShape.has(sid)) byShape.set(sid, []);
            byShape.get(sid)!.push(pt);
          }
          const shapeFeatures: Feature[] = [];
          for (const [shapeId, points] of byShape) {
            const sorted = points.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);
            if (sorted.length < 2) continue;
            shapeFeatures.push({
              type: 'Feature' as const,
              properties: { shape_id: shapeId },
              geometry: { type: 'LineString' as const, coordinates: sorted.map(p => [p.shape_pt_lon, p.shape_pt_lat]) },
            });
          }
          const shapeLinesFC = makeFeatureCollection(shapeFeatures);
          dissolvedFC = buildLinesDissolved(shapeLinesFC, state.bufferRadius, {}, 'shape_id');
        } else {
          const linesFC = await getLinesFC();
          dissolvedFC = buildLinesDissolved(
            linesFC, state.bufferRadius, { agency_name: agencyName },
            groupBy === 'none' ? undefined : groupBy,
          );
        }
        results['lines-dissolved'] = dissolvedFC;
        addLog('info', tf('log.features', 'lines-dissolved', dissolvedFC.features.length));
      }

      if (layer === 'envelope') {
        const rows = await queryStops(db, state.showTripTimes);
        const stopsFC = buildStopsGeoJSON(rows, ['stop_id'], coordinatePrecision);
        results.envelope = buildEnvelope(stopsFC, agencyName);
        addLog('info', tf('log.features', 'envelope', results.envelope.features.length));
      }

      if (layer === 'convex') {
        const rows = await queryStops(db, state.showTripTimes);
        const stopsFC = buildStopsGeoJSON(rows, ['stop_id'], coordinatePrecision);
        results.convex = buildConvexHull(stopsFC, agencyName);
        addLog('info', tf('log.features', 'convex', results.convex.features.length));
      }

      if (layer === 'concave') {
        const rows = await queryStops(db, state.showTripTimes);
        const stopsFC = buildStopsGeoJSON(rows, ['stop_id'], coordinatePrecision);
        results.concave = buildConcaveHull(stopsFC, state.concaveMaxEdge, agencyName);
        addLog('info', tf('log.features', 'concave', results.concave.features.length));
      }

      if (layer === 'segments') {
        const segRows = await querySegments(db, state.showTripTimes);
        results.segments = buildSegmentsGeoJSON(segRows, await getSegmentShapes(), props, coordinatePrecision);
        await enrichSegmentsWithRidership(results.segments);
        addLog('info', tf('log.features', 'segments', results.segments.features.length));
      }

      // 選択された route_id の集合で絞り込む（空なら全件）
      const allowedRouteIds = new Set(state.matchingRouteFilterIds.map(String));
      function applyRouteFilter(fc: FeatureCollection, routeIdProp = 'route_id'): FeatureCollection {
        if (allowedRouteIds.size === 0) return fc;
        fc.features = fc.features.filter(f => allowedRouteIds.has(String(f.properties?.[routeIdProp] ?? '')));
        return fc;
      }

      async function applyRouteFilterByStop(fc: FeatureCollection): Promise<FeatureCollection> {
        if (allowedRouteIds.size === 0) return fc;
        const conn2 = await db.connect();
        try {
          const inList = [...allowedRouteIds].map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
          const res = await conn2.query(`
            SELECT DISTINCT CAST(st.stop_id AS VARCHAR) AS stop_id
            FROM stop_times st
            JOIN trips t ON CAST(st.trip_id AS VARCHAR) = CAST(t.trip_id AS VARCHAR)
            WHERE CAST(t.route_id AS VARCHAR) IN (${inList})
          `);
          const allowedStops = new Set<string>();
          for (const row of res.toArray()) {
            const o = row.toJSON() as Record<string, unknown>;
            allowedStops.add(String(o.stop_id));
          }
          fc.features = fc.features.filter(f => allowedStops.has(String(f.properties?.stop_id ?? '')));
        } finally {
          await conn2.close();
        }
        return fc;
      }

      if (layer === 'matching-stops') {
        const rows = await queryStops(db, state.showTripTimes);
        const stopsFC = buildStopsGeoJSON(rows, [...getAvailableProperties('stops')], coordinatePrecision);
        await enrichStopsWithRidership(stopsFC);
        await applyRouteFilterByStop(stopsFC);
        results['matching-stops'] = stopsFC;
        addLog('info', tf('log.features', 'matching-stops', stopsFC.features.length));
      }

      if (layer === 'matching-lines') {
        const linesFC = await getLinesFC();
        await enrichRoutesWithRidership(linesFC);
        applyRouteFilter(linesFC);
        results['matching-lines'] = linesFC;
        addLog('info', tf('log.features', 'matching-lines', linesFC.features.length));
      }

      if (layer === 'matching-segments') {
        const segRows = await querySegments(db, state.showTripTimes);
        const segFC = buildSegmentsGeoJSON(segRows, await getSegmentShapes(), [...getAvailableProperties('segments')], coordinatePrecision);
        await enrichSegmentsWithRidership(segFC);
        applyRouteFilter(segFC);
        results['matching-segments'] = segFC;
        addLog('info', tf('log.features', 'matching-segments', segFC.features.length));
      }

      function buildArcFeatures(rows: RidershipArcRow[], valueKey: string): FeatureCollection {
        const features: Feature[] = rows.map(r => ({
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [r.boarding_lon, r.boarding_lat],
              [r.alighting_lon, r.alighting_lat],
            ],
          },
          properties: {
            boarding_stop_id: r.boarding_stop_id,
            boarding_stop_name: r.boarding_stop_name,
            boarding_lat: r.boarding_lat,
            boarding_lon: r.boarding_lon,
            alighting_stop_id: r.alighting_stop_id,
            alighting_stop_name: r.alighting_stop_name,
            alighting_lat: r.alighting_lat,
            alighting_lon: r.alighting_lon,
            [valueKey]: r.value,
            ...(r.hourly ?? {}),
          },
        }));
        return makeFeatureCollection(features);
      }

      function buildMatchingTripsFeatures(rows: MatchingTripSegmentRow[]): FeatureCollection {
        // SQL 側で OD レコードの日付込み unix を計算済み。停留所×便別実績では NULL なので
        // tripsBaseDate でフォールバック。
        const baseDate = state.tripsBaseDate || new Date().toISOString().slice(0, 10);
        const features: Feature[] = rows.map(r => {
          let departTs = r.departure_unix ?? null;
          let arriveTs = r.arrival_unix ?? null;
          if ((departTs == null || arriveTs == null) && r.departure_time && r.arrival_time) {
            departTs = parseGtfsTime(r.departure_time, baseDate);
            arriveTs = parseGtfsTime(r.arrival_time, baseDate);
          }
          const coords: number[][] = (departTs != null && arriveTs != null)
            ? [
                [r.from_stop_lon, r.from_stop_lat, 0, departTs],
                [r.to_stop_lon, r.to_stop_lat, 0, arriveTs],
              ]
            : [
                [r.from_stop_lon, r.from_stop_lat],
                [r.to_stop_lon, r.to_stop_lat],
              ];
          return {
            type: 'Feature' as const,
            geometry: { type: 'LineString' as const, coordinates: coords },
            properties: {
              trip_id: r.trip_id,
              date: r.date_str,
              route_id: r.route_id,
              route_short_name: r.route_short_name,
              route_long_name: r.route_long_name,
              service_id: r.service_id,
              direction_id: r.direction_id < 0 ? null : r.direction_id,
              from_stop_id: r.from_stop_id,
              from_stop_name: r.from_stop_name,
              to_stop_id: r.to_stop_id,
              to_stop_name: r.to_stop_name,
              departure_time: r.departure_time,
              arrival_time: r.arrival_time,
              onboard: r.onboard,
              boardings_at_from: r.boardings_at_from,
              alightings_at_to: r.alightings_at_to,
            },
          };
        });
        return makeFeatureCollection(features);
      }

      function buildMatchingRidershipFeatures(rows: MatchingRidershipRow[]): FeatureCollection {
        // SQL 側で日付込み unix 秒を計算済み。Kepler.gl Trip 形式に詰める。
        const features: Feature[] = rows.map(r => {
          const coords4: number[][] = r.coordinates.map((c, i) => {
            const ts = r.unix_times[i] ?? r.boarding_unix;
            return [c[0], c[1], 0, ts];
          });
          const durationMin = Math.max(
            0,
            Math.round((r.alighting_unix - r.boarding_unix) / 60),
          );
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: coords4,
            },
            properties: {
              ridership_record_id: r.row_id,
              trip_id: r.trip_id,
              date: r.date_str,
              route_id: r.route_id,
              route_short_name: r.route_short_name,
              route_long_name: r.route_long_name,
              boarding_stop_id: r.boarding_stop_id,
              boarding_stop_name: r.boarding_stop_name,
              boarding_time: unixToHHMM(r.boarding_unix),
              alighting_stop_id: r.alighting_stop_id,
              alighting_stop_name: r.alighting_stop_name,
              alighting_time: unixToHHMM(r.alighting_unix),
              passenger_count: r.passenger_count,
              duration_min: durationMin,
            },
          };
        });
        return makeFeatureCollection(features);
      }

      function unixToHHMM(unix: number): string {
        const tod = Math.floor(unix) % 86400;
        const h = Math.floor(tod / 3600);
        const m = Math.floor((tod % 3600) / 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }

      if (layer === 'matching-flow' && await tableExists(db, 'ridership_by_flow')) {
        const rows = await queryRidershipFlows(db);
        results['matching-flow'] = buildArcFeatures(rows, 'ridership');
        addLog('info', tf('log.features', 'matching-flow', results['matching-flow'].features.length));
      }

      if (layer === 'matching-od' && await tableExists(db, 'ridership_arc')) {
        const rows = await queryRidershipArcs(db);
        results['matching-od'] = buildArcFeatures(rows, 'passenger_count');
        addLog('info', tf('log.features', 'matching-od', results['matching-od'].features.length));
      }

      const fallbackDate = state.tripsBaseDate || new Date().toISOString().slice(0, 10);

      /** matching-trips / matching-ridership 共通: 便割り当て統計を計算し、UI / ログに反映 */
      async function recordTripAssignmentStats() {
        const stats = await queryTripAssignmentStats(db);
        set({ tripAssignmentStats: stats });
        if (stats.feedStartDate && stats.feedEndDate && stats.outOfFeedRange > 0) {
          addLog('warn', `${stats.outOfFeedRange} 日分の乗降データが GTFS feed_info 期間 (${stats.feedStartDate} 〜 ${stats.feedEndDate}) の外です。便割り当てが不正確になる可能性があります。`);
        }
        if (stats.uniqueDates.length > 0) {
          addLog('info', `便割り当て: ${stats.assigned} 行に対し ${stats.uniqueDates.length} 日のサービスカレンダーを参照 (${stats.uniqueDates[0]} 〜 ${stats.uniqueDates[stats.uniqueDates.length - 1]})`);
        }
      }

      // Phase 2: matching-trips（便 × 区間の onboard 可視化）
      if (layer === 'matching-trips' && rFieldConfig) {
        await buildMatchingTripsTable(db, rFieldConfig, state.reconciliationMode, fallbackDate);
        await recordTripAssignmentStats();
        const rows = await queryMatchingTripSegments(db);
        results['matching-trips'] = buildMatchingTripsFeatures(rows);
        applyRouteFilter(results['matching-trips']);
        addLog('info', tf('log.features', 'matching-trips', results['matching-trips'].features.length));
      }

      // Phase 3: matching-ridership（個票単位の軌跡）
      if (layer === 'matching-ridership' && rFieldConfig) {
        // 前段で trip assignment が必要なので buildMatchingTripsTable を先に走らせる
        await buildMatchingTripsTable(db, rFieldConfig, state.reconciliationMode, fallbackDate);
        await recordTripAssignmentStats();
        await buildMatchingRidershipTable(db, rFieldConfig, fallbackDate);
        const rows = await queryMatchingRidership(db);
        results['matching-ridership'] = buildMatchingRidershipFeatures(rows);
        applyRouteFilter(results['matching-ridership']);
        addLog('info', tf('log.features', 'matching-ridership', results['matching-ridership'].features.length));
      }

      // 時刻アニメ用バウンズの算出
      const timeBounds = computeTimeBounds(results);
      const stateNow = get();
      const newCurrent = timeBounds
        ? (stateNow.currentTime >= timeBounds.min && stateNow.currentTime <= timeBounds.max
            ? stateNow.currentTime
            : timeBounds.min)
        : stateNow.currentTime;

      set({
        generatedLayers: results,
        phase: 'done',
        progress: null,
        timeBounds,
        currentTime: newCurrent,
      });
      addLog('info', t('log.genComplete'));
    } catch (e) {
      addLog('error', tf('log.genError', e instanceof Error ? e.message : String(e)));
      set({ phase: 'loaded', progress: null });
    }
  },

  loadRidershipFile: async (file: File) => {
    const { addLog } = get();
    try {
      set({ progress: { current: 0, total: 4, label: t('log.ridershipReading') } });
      addLog('info', t('log.ridershipReading'));
      const result = await readRidershipFile(file);
      if (isExcelResult(result)) {
        set({ excelSheets: result.sheets, excelFile: result.file, progress: null });
        addLog('info', tf('log.ridershipExcel', result.sheets.length));
        return;
      }
      set({ progress: { current: 1, total: 4, label: t('log.ridershipDetecting') } });
      const format = detectRidershipFormat(result.headers);
      const config = defaultFieldConfig(format, result.headers);
      set({ progress: { current: 2, total: 4, label: t('log.ridershipDbLoading') } });
      const db = await getDb();
      const rowCount = await loadRidershipCsv(db, result.csvText);
      set({
        ridershipSummary: { format, rowCount },
        ridershipColumns: result.headers,
        fieldConfig: config,
        excelSheets: null,
        excelFile: null,
        joinStats: null,
        tripAssignmentStats: null,
        stopMapping: [],
        routeMapping: [],
        agencyMapping: [],
        gtfsCandidates: { stop: [], route: [], agency: [] },
      });
      addLog('info', tf('log.ridershipLoaded', rowCount, format));
      if (get().reconciliationMode === 'auto-match') {
        set({ progress: { current: 3, total: 4, label: t('log.ridershipMatching') } });
        await get().runAllAutoMatch();
      }
      set({ progress: null });
    } catch (e) {
      addLog('error', tf('log.ridershipError', e instanceof Error ? e.message : String(e)));
      set({ progress: null });
    }
  },

  loadExcelSheet: async (sheetName: string) => {
    const { addLog, excelFile } = get();
    if (!excelFile) return;
    try {
      set({ progress: { current: 0, total: 4, label: t('log.ridershipReading') } });
      addLog('info', t('log.ridershipReading'));
      const result = await readExcelSheet(excelFile, sheetName);
      set({ progress: { current: 1, total: 4, label: t('log.ridershipDetecting') } });
      const format = detectRidershipFormat(result.headers);
      const config = defaultFieldConfig(format, result.headers);
      set({ progress: { current: 2, total: 4, label: t('log.ridershipDbLoading') } });
      const db = await getDb();
      const rowCount = await loadRidershipCsv(db, result.csvText);
      set({
        ridershipSummary: { format, rowCount },
        ridershipColumns: result.headers,
        fieldConfig: config,
        excelSheets: null,
        excelFile: null,
        joinStats: null,
        tripAssignmentStats: null,
        stopMapping: [],
        routeMapping: [],
        agencyMapping: [],
        gtfsCandidates: { stop: [], route: [], agency: [] },
      });
      addLog('info', tf('log.ridershipLoaded', rowCount, format));
      if (get().reconciliationMode === 'auto-match') {
        set({ progress: { current: 3, total: 4, label: t('log.ridershipMatching') } });
        await get().runAllAutoMatch();
      }
      set({ progress: null });
    } catch (e) {
      addLog('error', tf('log.ridershipError', e instanceof Error ? e.message : String(e)));
      set({ progress: null });
    }
  },

  setRidershipFormat: (format) => {
    const { ridershipSummary, ridershipColumns } = get();
    if (!ridershipSummary) return;
    const config = defaultFieldConfig(format, ridershipColumns);
    set({
      ridershipSummary: { ...ridershipSummary, format },
      fieldConfig: config,
      stopMapping: [],
      routeMapping: [],
      agencyMapping: [],
      gtfsCandidates: { stop: [], route: [], agency: [] },
      joinStats: null,
      tripAssignmentStats: null,
    });
    if (get().reconciliationMode === 'auto-match') get().runAllAutoMatch();
  },

  setReconciliationMode: (mode) => {
    set({ reconciliationMode: mode });
    if (mode === 'auto-match') get().runAllAutoMatch();
  },
  setFieldConfig: (config) => {
    set({ fieldConfig: config });
    if (get().reconciliationMode === 'auto-match') get().runAllAutoMatch();
  },

  startAutoMatch: async (type: MappingType) => {
    const { addLog, fieldConfig, ridershipColumns } = get();
    if (!fieldConfig) return;

    const findNameCol = (codeCol: string): string | null => {
      const patterns: [RegExp, string][] = [
        [/ID$/i, '名'],
        [/_code$/i, '_name'],
        [/_id$/i, '_name'],
      ];
      const colSet = new Set(ridershipColumns);
      for (const [pat, rep] of patterns) {
        if (pat.test(codeCol)) {
          const candidate = codeCol.replace(pat, rep);
          if (candidate !== codeCol && colSet.has(candidate)) return candidate;
        }
      }
      return null;
    };

    try {
      const db = await getDb();
      let odEntries: { code: string; name: string }[];
      let groups: CandidateGroup[];
      if (type === 'stop') {
        const cols = [fieldConfig.boardingStopCol, fieldConfig.alightingStopCol].filter((c): c is string => c !== null);
        const nameCols = cols.map(c => fieldConfig.stopGtfsField === 'stop_id' ? findNameCol(c) : null);
        odEntries = await queryDistinctOdValues(db, cols, nameCols);
        groups = await queryGtfsStopGroups(db, fieldConfig.stopGtfsField);
      } else if (type === 'route') {
        const cols = [fieldConfig.routeCol].filter((c): c is string => c !== null);
        const nameCols = cols.map(c => fieldConfig.routeGtfsField === 'route_id' ? findNameCol(c) : null);
        odEntries = await queryDistinctOdValues(db, cols, nameCols);
        const flat = await queryGtfsRoutesForMatch(db, fieldConfig.routeGtfsField);
        groups = flat.map(e => ({ groupId: e.id, groupName: e.name, entries: [e] }));
      } else {
        const cols = [fieldConfig.agencyCol].filter((c): c is string => c !== null);
        const nameCols = cols.map(c => fieldConfig.agencyGtfsField === 'agency_id' ? findNameCol(c) : null);
        odEntries = await queryDistinctOdValues(db, cols, nameCols);
        const flat = await queryGtfsAgenciesForMatch(db, fieldConfig.agencyGtfsField);
        groups = flat.map(e => ({ groupId: e.id, groupName: e.name, entries: [e] }));
      }
      const mapping = autoMatch(odEntries, groups);
      const matched = mapping.filter(r => r.status !== 'unmatched').length;
      const key = `${type}Mapping` as const;
      set({ [key]: mapping, gtfsCandidates: { ...get().gtfsCandidates, [type]: groups } });
      addLog('info', tf('log.autoMatchDone', type, matched, mapping.length));
    } catch (e) {
      addLog('error', tf('log.ridershipError', e instanceof Error ? e.message : String(e)));
    }
  },

  runAllAutoMatch: async () => {
    const { fieldConfig, startAutoMatch } = get();
    if (!fieldConfig) return;
    if (fieldConfig.boardingStopCol || fieldConfig.alightingStopCol) await startAutoMatch('stop');
    if (fieldConfig.routeCol) await startAutoMatch('route');
    if (fieldConfig.agencyCol) await startAutoMatch('agency');
  },

  updateMappingRow: (type: MappingType, odCode: string, gtfsIds: { id: string; name: string }[]) => {
    const key = `${type}Mapping` as const;
    const rows = get()[key];
    const updated = rows.map(r =>
      r.odCode === odCode
        ? { ...r, gtfsIds, status: gtfsIds.length > 0 ? 'manual' as const : 'skipped' as const }
        : r,
    );
    set({ [key]: updated });
  },

  importMappingCsv: async (type: MappingType, file: File) => {
    const { addLog } = get();
    try {
      set({ progress: { current: 0, total: 2, label: t('log.ridershipReading') } });
      const { detectAndDecode } = await import('../gtfs/encoding');
      const buffer = await file.arrayBuffer();
      const csvText = detectAndDecode(buffer);
      set({ progress: { current: 1, total: 2, label: t('log.ridershipDbLoading') } });
      const db = await getDb();
      const { count, rows } = await loadMappingCsv(db, type, csvText);

      const grouped = new Map<string, string[]>();
      for (const r of rows) {
        const arr = grouped.get(r.odValue);
        if (arr) arr.push(r.gtfsValue);
        else grouped.set(r.odValue, [r.gtfsValue]);
      }

      const mappingRows: MappingRow[] = Array.from(grouped.entries()).map(([od, gtfsVals]) => ({
        odCode: od,
        odName: od,
        gtfsIds: gtfsVals.map(v => ({ id: v, name: v })),
        status: 'manual' as const,
      }));

      const key = `${type}Mapping` as const;
      set({ [key]: mappingRows, progress: null });
      addLog('info', tf('log.mappingImported', type, count));
    } catch (e) {
      addLog('error', tf('log.ridershipError', e instanceof Error ? e.message : String(e)));
      set({ progress: null });
    }
  },

  confirmMapping: async (type: MappingType) => {
    const { addLog } = get();
    const key = `${type}Mapping` as const;
    const rows = get()[key];
    try {
      const db = await getDb();
      await loadMappingRows(db, type, rows);
      const matched = rows.filter(r => r.gtfsIds.length > 0).length;
      addLog('info', tf('log.mappingConfirmed', type, matched));
    } catch (e) {
      addLog('error', tf('log.ridershipError', e instanceof Error ? e.message : String(e)));
    }
  },

  executeJoin: async () => {
    const { addLog, fieldConfig, reconciliationMode, stopMapping, routeMapping, agencyMapping } = get();
    if (!fieldConfig) return;
    try {
      set({ progress: { current: 0, total: 2, label: t('ridership.join') } });
      const db = await getDb();
      if (reconciliationMode !== 'direct') {
        if (stopMapping.length > 0) await loadMappingRows(db, 'stop', stopMapping);
        if (routeMapping.length > 0) await loadMappingRows(db, 'route', routeMapping);
        if (agencyMapping.length > 0) await loadMappingRows(db, 'agency', agencyMapping);
      }
      set({ progress: { current: 1, total: 2, label: t('ridership.join') } });
      const stats = await executeRidershipJoin(db, fieldConfig, reconciliationMode);
      set({ joinStats: stats, progress: null });
      addLog('info', tf('log.joinComplete', stats.matched, stats.unmatched, stats.coverageStops, stats.coverageRoutes));
    } catch (e) {
      addLog('error', tf('log.ridershipError', e instanceof Error ? e.message : String(e)));
      set({ progress: null });
    }
  },

  clearRidership: async () => {
    const { addLog } = get();
    try {
      const db = await getDb();
      await dropRidershipTables(db);
      set({
        ridershipSummary: null,
        ridershipColumns: [],
        fieldConfig: null,
        reconciliationMode: 'auto-match' as ReconciliationMode,
        stopMapping: [],
        routeMapping: [],
        agencyMapping: [],
        gtfsCandidates: { stop: [], route: [], agency: [] },
        joinStats: null,
        tripAssignmentStats: null,
        excelSheets: null,
        excelFile: null,
      });
      addLog('info', t('log.ridershipCleared'));
    } catch (e) {
      addLog('error', tf('log.ridershipError', e instanceof Error ? e.message : String(e)));
    }
  },

  loadRouteStops: async () => {
    try {
      const db = await getDb();
      const conn = await db.connect();
      let routeInfoList: Array<{ route_id: string; route_short_name: string | null; route_long_name: string | null }> = [];
      try {
        const res = await conn.query(`
          SELECT CAST(route_id AS VARCHAR) AS route_id, route_short_name, route_long_name
          FROM routes ORDER BY route_id
        `);
        routeInfoList = res.toArray().map(r => {
          const obj = r.toJSON() as Record<string, unknown>;
          return {
            route_id: String(obj.route_id),
            route_short_name: obj.route_short_name ? String(obj.route_short_name) : null,
            route_long_name: obj.route_long_name ? String(obj.route_long_name) : null,
          };
        });
      } finally {
        await conn.close();
      }
      const rows = await queryRouteStopLists(db);
      const stopsByRoute: Record<string, Array<{ stop_id: string; stop_name: string }>> = {};
      for (const row of rows) {
        if (!stopsByRoute[row.route_id]) stopsByRoute[row.route_id] = [];
        stopsByRoute[row.route_id]!.push({ stop_id: row.stop_id, stop_name: row.stop_name });
      }
      set({ routeInfoList, routeStopsByRoute: stopsByRoute });
    } catch (e) {
      get().addLog('error', `Failed to load route stops: ${e instanceof Error ? e.message : String(e)}`);
    }
  },

  setTravelTimeTarget: (routeId, stopId) => {
    set(s => ({
      travelTimeTargets: { ...s.travelTimeTargets, [routeId]: stopId },
    }));
  },

  clearTravelTimeTargets: () => set({ travelTimeTargets: {} }),

  reset: async () => {
    await resetDb();
    set({
      phase: 'idle',
      gtfsSummary: null,
      validationResults: [],
      selectedLayer: 'stops' as LayerType,
      tripsBaseDate: new Date().toISOString().slice(0, 10),
      tripsRouteFilter: '',
      bufferRadius: 300,
      concaveMaxEdge: 2,
      stopsDissolvedGroupBy: 'none' as StopsDissolvedGroupBy,
      linesDissolvedGroupBy: 'none' as LinesDissolvedGroupBy,
      selectedProperties: { ...initialProperties },
      exportFormat: 'geojson' as ExportFormat,
      generatedLayers: {},
      logs: [],
      progress: null,
      ridershipSummary: null,
      ridershipColumns: [],
      fieldConfig: null,
      reconciliationMode: 'auto-match' as ReconciliationMode,
      stopMapping: [],
      routeMapping: [],
      agencyMapping: [],
      gtfsCandidates: { stop: [], route: [], agency: [] },
      matchingOutputLayer: 'matching-stops' as MatchingOutputLayer,
      matchingRouteFilterIds: [],
      matchingShowRidershipPerTrip: false,
      showTripTimes: false,
      matchingJoinAllColumns: false,
      matchingOnlyMatched: false,
      keyColumnDuplicates: null,
      joinStats: null,
      tripAssignmentStats: null,
      excelSheets: null,
      excelFile: null,
      routeInfoList: [],
      routeStopsByRoute: {},
      travelTimeTargets: {},
    });
  },
}));
