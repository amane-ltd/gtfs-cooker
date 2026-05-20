export type Language = 'en' | 'ja';

const LANG_KEY = 'gtfs-cooker-lang';

let _lang: Language = (() => {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'ja' || v === 'en') return v; } catch {}
  return 'en';
})();

export function getLanguage(): Language { return _lang; }

export function setLanguage(lang: Language) {
  _lang = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
}

const en = {
  'section.load': '1. Load GTFS',
  'section.results': '2. Load Results',
  'section.layer': '3. Output Layer',
  'section.properties': '4. Output Properties',

  'summary.agency': 'Agency:',
  'summary.routes': 'Routes:',
  'summary.stops': 'Stops:',
  'summary.trips': 'Trips:',
  'summary.yes': 'Yes',
  'summary.no': 'No',

  'drop.drag': 'Drag & drop GTFS ZIP',
  'drop.click': 'or click to select a file',
  'drop.load': 'Load',

  'layer.stops': 'Point — All stops',
  'layer.lines': 'MultiLineString — Routes',
  'layer.trips': 'LineString — Kepler.gl Trip format',
  'layer.baseDate': 'Base date (required)',
  'layer.routeFilter': 'route_id filter (optional)',
  'layer.routePlaceholder': 'e.g. route_001',

  'props.format': 'Export format',
  'props.selectAll': 'Select all',
  'props.clearAll': 'Clear all',

  'btn.generate': 'Generate',
  'btn.generating': 'Generating...',

  'privacy': 'Data is not sent to any server',
  'log': 'Log',
  'log.empty': 'Load a GTFS ZIP file to begin',

  'log.fileStart': (name: string) => `Loading file: ${name}`,
  'log.validationError': 'Validation errors found',
  'log.loadingFile': (name: string) => `Loading ${name}...`,
  'log.processingFile': (name: string) => `Processing ${name}...`,
  'log.tableRows': (table: string, count: string) => `${table}: ${count} rows`,
  'log.skipFile': (name: string, err: string) => `Skipped ${name}: ${err}`,
  'log.loadComplete': (stops: number, routes: number, trips: number) =>
    `Load complete: ${stops} stops, ${routes} routes, ${trips} trips`,
  'log.loadError': (msg: string) => `Load error: ${msg}`,
  'log.downloadStart': (url: string) => `Downloading from URL: ${url}`,
  'log.downloadDone': (name: string, size: string) => `Download complete: ${name} (${size} MB)`,
  'log.urlError': (msg: string) => `URL load error: ${msg}`,
  'log.corsError': 'CORS not allowed or network error',
  'log.generating': (layer: string) => `Generating ${layer} layer...`,
  'log.features': (layer: string, count: number) => `${layer}: ${count} features`,
  'log.noBaseDate': 'trips: Base date not set',
  'log.genComplete': 'Generation complete',
  'log.genError': (msg: string) => `Generation error: ${msg}`,
} as const;

type Dict = { [K in keyof typeof en]: (typeof en)[K] extends (...args: infer A) => string ? (...args: A) => string : string };

const ja: Dict = {
  'section.load': '1. GTFS 読み込み',
  'section.results': '2. 読み込み結果',
  'section.layer': '3. 出力レイヤー',
  'section.properties': '4. 出力プロパティ',

  'summary.agency': '事業者:',
  'summary.routes': '路線数:',
  'summary.stops': '停留所数:',
  'summary.trips': '便数:',
  'summary.yes': 'あり',
  'summary.no': 'なし',

  'drop.drag': 'GTFS ZIP をドラッグ&ドロップ',
  'drop.click': 'またはクリックしてファイルを選択',
  'drop.load': '読込',

  'layer.stops': 'Point — 全停留所',
  'layer.lines': 'MultiLineString — 路線',
  'layer.trips': 'LineString — Kepler.gl Trip 形式',
  'layer.baseDate': '基準日（必須）',
  'layer.routeFilter': 'route_id 絞り込み（任意）',
  'layer.routePlaceholder': '例: route_001',

  'props.format': '出力形式',
  'props.selectAll': '全選択',
  'props.clearAll': '全解除',

  'btn.generate': '生成',
  'btn.generating': '生成中...',

  'privacy': 'データはサーバーに送信されません',
  'log': 'ログ',
  'log.empty': 'GTFS ZIP ファイルを読み込んでください',

  'log.fileStart': (name: string) => `ファイル読み込み開始: ${name}`,
  'log.validationError': 'バリデーションエラーがあります',
  'log.loadingFile': (name: string) => `${name} を読み込み中...`,
  'log.processingFile': (name: string) => `${name} を処理中...`,
  'log.tableRows': (table: string, count: string) => `${table}: ${count} 行`,
  'log.skipFile': (name: string, err: string) => `${name} の読み込みをスキップ: ${err}`,
  'log.loadComplete': (stops: number, routes: number, trips: number) =>
    `読み込み完了: ${stops} 停留所, ${routes} 路線, ${trips} 便`,
  'log.loadError': (msg: string) => `読み込みエラー: ${msg}`,
  'log.downloadStart': (url: string) => `URL からダウンロード中: ${url}`,
  'log.downloadDone': (name: string, size: string) => `ダウンロード完了: ${name} (${size} MB)`,
  'log.urlError': (msg: string) => `URL 読み込みエラー: ${msg}`,
  'log.corsError': 'CORS が許可されていないか、ネットワークエラーです',
  'log.generating': (layer: string) => `${layer} レイヤーを生成中...`,
  'log.features': (layer: string, count: number) => `${layer}: ${count} フィーチャー`,
  'log.noBaseDate': 'trips: 基準日が未設定です',
  'log.genComplete': '生成完了',
  'log.genError': (msg: string) => `生成エラー: ${msg}`,
};

const dictionaries = { en, ja } as const;

type StringKeys = { [K in keyof typeof en]: (typeof en)[K] extends string ? K : never }[keyof typeof en];

export function t(key: StringKeys): string {
  return dictionaries[_lang][key] as string;
}

export function tf<K extends keyof typeof en>(
  key: K,
  ...args: (typeof en)[K] extends (...a: infer A) => string ? A : never
): string {
  const val = dictionaries[_lang][key];
  if (typeof val === 'function') return (val as (...a: unknown[]) => string)(...args);
  return val as string;
}
