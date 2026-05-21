import { create } from 'zustand';
import type { FeatureCollection } from 'geojson';
import type { GtfsSummary, ValidationResult, LogEntry, LayerType, MatchingOutputLayer, StopsDissolvedGroupBy, LinesDissolvedGroupBy } from '../gtfs/types';
import { getAvailableProperties } from '../gtfs/types';
import { getDb, resetDb } from '../db/init';
import { dropAllTables, loadCsvIntoTable, getTableRowCount, tableExists } from '../db/loader';
import { queryStops, queryShapePoints, queryRoutesWithShapes, queryTripsForDate, queryStopSequenceForRoute, querySegments } from '../db/queries';
import { buildStopsGeoJSON } from '../geojson/stops';
import { buildLinesGeoJSON } from '../geojson/lines';
import { buildTripsGeoJSON } from '../geojson/trips';
import { buildStopsBuffer, buildLinesBuffer } from '../geojson/buffer';
import { buildStopsDissolved, buildLinesDissolved } from '../geojson/dissolved';
import { buildEnvelope, buildConvexHull, buildConcaveHull } from '../geojson/area';
import { buildSegmentsGeoJSON } from '../geojson/segments';
import { makeFeatureCollection } from '../geojson/helpers';
import { detectAndDecode } from '../gtfs/encoding';
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
import { queryDistinctOdValues, queryGtfsStopGroups, queryGtfsRoutesForMatch, queryGtfsAgenciesForMatch, executeRidershipJoin, queryRidershipFlows, queryRidershipArcs } from '../db/ridership-queries';
import type { RidershipArcRow } from '../db/ridership-queries';

export type Phase = 'idle' | 'loading' | 'loaded' | 'generating' | 'done';
export type ExportFormat = 'geojson' | 'csv' | 'xlsx';

const ALL_LAYERS: LayerType[] = [
  'stops', 'lines', 'trips',
  'stops-buffer', 'lines-buffer',
  'stops-dissolved', 'lines-dissolved',
  'envelope', 'convex', 'concave',
  'segments',
  'matching',
  'matching-stops', 'matching-lines', 'matching-segments',
  'matching-flow', 'matching-arc',
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
  matchingOutputLayer: MatchingOutputLayer;
  excelSheets: string[] | null;
  excelFile: File | null;
  is3D: boolean;

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
  setMatchingOutputLayer: (layer: MatchingOutputLayer) => void;
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
  tripsBaseDate: '',
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
  joinStats: null,
  matchingOutputLayer: 'matching-stops' as MatchingOutputLayer,
  excelSheets: null,
  excelFile: null,
  is3D: false,

  setIs3D: (v) => set({ is3D: v }),
  setMatchingOutputLayer: (layer) => set({ matchingOutputLayer: layer }),

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

      set({ gtfsSummary: summary, phase: 'loaded' });
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

      // Helper: build lines FeatureCollection (reused by lines-buffer, dissolved)
      async function getLinesFC() {
        const routes = await queryRoutesWithShapes(db);
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
        return buildLinesGeoJSON(routes, shapePoints, [...getAvailableProperties('lines')], coordinatePrecision, fallbackStops);
      }

      const hasRidershipStops = await tableExists(db, 'ridership_by_stop');
      const hasRidershipRoutes = await tableExists(db, 'ridership_by_route');
      const hasRidershipSegments = await tableExists(db, 'ridership_by_segment');
      const rFieldConfig = state.fieldConfig;

      async function enrichStopsWithRidership(fc: FeatureCollection) {
        if (!hasRidershipStops) return fc;
        const conn2 = await db.connect();
        try {
          const res = await conn2.query(`SELECT gtfs_stop_val, count_on, count_off FROM ridership_by_stop`);
          const map = new Map<string, { count_on: number; count_off: number }>();
          for (const row of res.toArray()) {
            const o = row.toJSON() as Record<string, unknown>;
            map.set(String(o.gtfs_stop_val), {
              count_on: Number(o.count_on ?? 0),
              count_off: Number(o.count_off ?? 0),
            });
          }
          const matchProp = rFieldConfig?.stopGtfsField ?? 'stop_name';
          for (const feat of fc.features) {
            const sid = String(feat.properties?.[matchProp] ?? '');
            const r = map.get(sid);
            if (r) {
              feat.properties = { ...feat.properties, ridership_on: r.count_on, ridership_off: r.count_off };
            }
          }
        } finally {
          await conn2.close();
        }
        return fc;
      }

      async function enrichRoutesWithRidership(fc: FeatureCollection) {
        if (!hasRidershipRoutes) return fc;
        const conn2 = await db.connect();
        try {
          const res = await conn2.query(`SELECT gtfs_route_val, ridership_count FROM ridership_by_route`);
          const map = new Map<string, number>();
          for (const row of res.toArray()) {
            const o = row.toJSON() as Record<string, unknown>;
            map.set(String(o.gtfs_route_val), Number(o.ridership_count ?? 0));
          }
          const matchProp = rFieldConfig?.routeGtfsField ?? 'route_long_name';
          for (const feat of fc.features) {
            const rid = String(feat.properties?.[matchProp] ?? '');
            const count = map.get(rid);
            if (count !== undefined) {
              feat.properties = { ...feat.properties, ridership_count: count };
            }
          }
        } finally {
          await conn2.close();
        }
        return fc;
      }

      async function enrichSegmentsWithRidership(fc: FeatureCollection) {
        if (!hasRidershipSegments) return fc;
        const conn2 = await db.connect();
        try {
          const res = await conn2.query(`SELECT from_stop_val, to_stop_val, riders FROM ridership_by_segment`);
          const map = new Map<string, number>();
          for (const row of res.toArray()) {
            const o = row.toJSON() as Record<string, unknown>;
            map.set(`${o.from_stop_val}->${o.to_stop_val}`, Number(o.riders ?? 0));
          }
          const matchProp = rFieldConfig?.stopGtfsField === 'stop_name' ? 'from_stop_name' : 'from_stop_id';
          const matchProp2 = rFieldConfig?.stopGtfsField === 'stop_name' ? 'to_stop_name' : 'to_stop_id';
          for (const feat of fc.features) {
            const key = `${feat.properties?.[matchProp]}->${feat.properties?.[matchProp2]}`;
            const riders = map.get(key);
            if (riders !== undefined) {
              feat.properties = { ...feat.properties, ridership: riders };
            }
          }
        } finally {
          await conn2.close();
        }
        return fc;
      }

      if (layer === 'stops') {
        const rows = await queryStops(db);
        results.stops = buildStopsGeoJSON(rows, props, coordinatePrecision);
        await enrichStopsWithRidership(results.stops);
        addLog('info', tf('log.features', 'stops', results.stops.features.length));
      }

      if (layer === 'lines') {
        results.lines = await getLinesFC();
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
        const rows = await queryStops(db);
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
        const rows = await queryStops(db);
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
        const rows = await queryStops(db);
        const stopsFC = buildStopsGeoJSON(rows, ['stop_id'], coordinatePrecision);
        results.envelope = buildEnvelope(stopsFC, agencyName);
        addLog('info', tf('log.features', 'envelope', results.envelope.features.length));
      }

      if (layer === 'convex') {
        const rows = await queryStops(db);
        const stopsFC = buildStopsGeoJSON(rows, ['stop_id'], coordinatePrecision);
        results.convex = buildConvexHull(stopsFC, agencyName);
        addLog('info', tf('log.features', 'convex', results.convex.features.length));
      }

      if (layer === 'concave') {
        const rows = await queryStops(db);
        const stopsFC = buildStopsGeoJSON(rows, ['stop_id'], coordinatePrecision);
        results.concave = buildConcaveHull(stopsFC, state.concaveMaxEdge, agencyName);
        addLog('info', tf('log.features', 'concave', results.concave.features.length));
      }

      if (layer === 'segments') {
        const segRows = await querySegments(db);
        results.segments = buildSegmentsGeoJSON(segRows, props, coordinatePrecision);
        await enrichSegmentsWithRidership(results.segments);
        addLog('info', tf('log.features', 'segments', results.segments.features.length));
      }

      if (layer === 'matching-stops') {
        const rows = await queryStops(db);
        const stopsFC = buildStopsGeoJSON(rows, [...getAvailableProperties('stops')], coordinatePrecision);
        await enrichStopsWithRidership(stopsFC);
        results['matching-stops'] = stopsFC;
        addLog('info', tf('log.features', 'matching-stops', stopsFC.features.length));
      }

      if (layer === 'matching-lines') {
        const linesFC = await getLinesFC();
        await enrichRoutesWithRidership(linesFC);
        results['matching-lines'] = linesFC;
        addLog('info', tf('log.features', 'matching-lines', linesFC.features.length));
      }

      if (layer === 'matching-segments') {
        const segRows = await querySegments(db);
        const segFC = buildSegmentsGeoJSON(segRows, [...getAvailableProperties('segments')], coordinatePrecision);
        await enrichSegmentsWithRidership(segFC);
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
          },
        }));
        return makeFeatureCollection(features);
      }

      if (layer === 'matching-flow' && await tableExists(db, 'ridership_by_flow')) {
        const rows = await queryRidershipFlows(db);
        results['matching-flow'] = buildArcFeatures(rows, 'ridership');
        addLog('info', tf('log.features', 'matching-flow', results['matching-flow'].features.length));
      }

      if (layer === 'matching-arc' && await tableExists(db, 'ridership_arc')) {
        const rows = await queryRidershipArcs(db);
        results['matching-arc'] = buildArcFeatures(rows, 'passenger_count');
        addLog('info', tf('log.features', 'matching-arc', results['matching-arc'].features.length));
      }

      set({ generatedLayers: results, phase: 'done', progress: null });
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
        excelSheets: null,
        excelFile: null,
      });
      addLog('info', t('log.ridershipCleared'));
    } catch (e) {
      addLog('error', tf('log.ridershipError', e instanceof Error ? e.message : String(e)));
    }
  },

  reset: async () => {
    await resetDb();
    set({
      phase: 'idle',
      gtfsSummary: null,
      validationResults: [],
      selectedLayer: 'stops' as LayerType,
      tripsBaseDate: '',
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
      joinStats: null,
      excelSheets: null,
      excelFile: null,
    });
  },
}));
