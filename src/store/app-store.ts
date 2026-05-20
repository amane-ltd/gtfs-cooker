import { create } from 'zustand';
import type { FeatureCollection } from 'geojson';
import type { GtfsSummary, ValidationResult, LogEntry, LayerType } from '../gtfs/types';
import { getAvailableProperties } from '../gtfs/types';
import { getDb, resetDb } from '../db/init';
import { dropAllTables, loadCsvIntoTable, getTableRowCount, tableExists } from '../db/loader';
import { queryStops, queryShapePoints, queryRoutesWithShapes, queryTripsForDate, queryStopSequenceForRoute } from '../db/queries';
import { buildStopsGeoJSON } from '../geojson/stops';
import { buildLinesGeoJSON } from '../geojson/lines';
import { buildTripsGeoJSON } from '../geojson/trips';
import { detectAndDecode } from '../gtfs/encoding';
import { validateFiles, validateColumns } from '../gtfs/validator';
import { t, tf, getLanguage, setLanguage as setI18nLanguage } from '../i18n';
import type { Language } from '../i18n';
import JSZip from 'jszip';

export type Phase = 'idle' | 'loading' | 'loaded' | 'generating' | 'done';
export type ExportFormat = 'geojson' | 'csv' | 'xlsx';

interface AppState {
  language: Language;
  phase: Phase;
  gtfsSummary: GtfsSummary | null;
  validationResults: ValidationResult[];
  selectedLayer: LayerType;
  tripsBaseDate: string;
  tripsRouteFilter: string;
  selectedProperties: Record<LayerType, string[]>;
  exportFormat: ExportFormat;
  generatedLayers: Record<string, FeatureCollection>;
  logs: LogEntry[];
  progress: { current: number; total: number; label: string } | null;

  setLanguage: (lang: Language) => void;
  addLog: (level: LogEntry['level'], message: string) => void;
  setPhase: (phase: Phase) => void;
  selectLayer: (layer: LayerType) => void;
  setTripsBaseDate: (date: string) => void;
  setTripsRouteFilter: (filter: string) => void;
  setSelectedProperties: (layer: LayerType, props: string[]) => void;
  setExportFormat: (f: ExportFormat) => void;
  loadGtfsFile: (file: File) => Promise<void>;
  loadGtfsUrl: (url: string) => Promise<void>;
  generateLayers: () => Promise<void>;
  reset: () => void;
}

const initialProperties: Record<LayerType, string[]> = {
  stops: [...getAvailableProperties('stops')],
  lines: [...getAvailableProperties('lines')],
  trips: [...getAvailableProperties('trips')],
};

export const useAppStore = create<AppState>((set, get) => ({
  language: getLanguage(),
  phase: 'idle',
  gtfsSummary: null,
  validationResults: [],
  selectedLayer: 'stops' as LayerType,
  tripsBaseDate: '',
  tripsRouteFilter: '',
  selectedProperties: { ...initialProperties },
  exportFormat: 'geojson' as ExportFormat,
  generatedLayers: {},
  logs: [],
  progress: null,

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
      const layer = selectedLayer;

      set({ progress: { current: 0, total: 1, label: tf('log.generating', layer) } });
      addLog('info', tf('log.generating', layer));

      const props = state.selectedProperties[layer] ?? [];

      if (layer === 'stops') {
          const rows = await queryStops(db);
          results.stops = buildStopsGeoJSON(rows, props, coordinatePrecision);
          addLog('info', tf('log.features', 'stops', results.stops.features.length));
        }

        if (layer === 'lines') {
          const routes = await queryRoutesWithShapes(db);
          const hasShapes = await tableExists(db, 'shapes');

          let shapePoints: import('../db/queries').ShapePoint[] = [];
          let fallbackStops: Map<string, Array<{ stop_lat: number; stop_lon: number }>> | undefined;

          if (hasShapes) {
            shapePoints = await queryShapePoints(db);
          } else {
            fallbackStops = new Map();
            for (const route of routes) {
              const stops = await queryStopSequenceForRoute(db, String(route.route_id));
              if (stops.length >= 2) {
                fallbackStops.set(String(route.route_id), stops);
              }
            }
          }

          results.lines = buildLinesGeoJSON(
            routes, shapePoints, props, coordinatePrecision, fallbackStops,
          );
          addLog('info', tf('log.features', 'lines', results.lines.features.length));
        }

        if (layer === 'trips') {
          if (!state.tripsBaseDate) {
            addLog('warn', t('log.noBaseDate'));
          } else {
            const stopTimes = await queryTripsForDate(
              db, state.tripsBaseDate, state.tripsRouteFilter || undefined,
            );
            results.trips = buildTripsGeoJSON(stopTimes, state.tripsBaseDate, props, coordinatePrecision);
            addLog('info', tf('log.features', 'trips', results.trips.features.length));
          }
        }

      set({ generatedLayers: results, phase: 'done', progress: null });
      addLog('info', t('log.genComplete'));
    } catch (e) {
      addLog('error', tf('log.genError', e instanceof Error ? e.message : String(e)));
      set({ phase: 'loaded', progress: null });
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
      selectedProperties: { ...initialProperties },
      exportFormat: 'geojson' as ExportFormat,
      generatedLayers: {},
      logs: [],
      progress: null,
    });
  },
}));
