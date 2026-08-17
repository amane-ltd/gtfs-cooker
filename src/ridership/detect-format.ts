import type { RidershipFormat, RidershipFieldConfig } from './types';

export function detectRidershipFormat(headers: string[]): RidershipFormat {
  const set = new Set(headers.map(h => h.trim().toLowerCase()));

  if (set.has('ridership_record_id') && set.has('payment_at')) {
    return 'commons-detail';
  }

  if (set.has('count_on') && set.has('count_off')) {
    return 'station-aggregate';
  }

  if (set.has('boarding_station_code') && set.has('alighting_station_code') && set.has('count')) {
    return 'od-aggregate';
  }

  if ((set.has('boarding_route_id') || set.has('route_id')) && set.has('count')) {
    return 'route-aggregate';
  }

  if (set.has('乗車人数') && set.has('降車人数') && (set.has('停留所名') || set.has('停留所') || set.has('停留所id')) && set.has('便id')) {
    return 'stop-trip-detail';
  }

  // 英語ヘッダ版（stop-trip-detail）。`count` を持たないため route-aggregate 等とは競合しない。
  if (set.has('boarding_count') && set.has('alighting_count') && (set.has('stop_name') || set.has('stop') || set.has('stop_id')) && set.has('trip_id')) {
    return 'stop-trip-detail';
  }

  return 'unknown';
}

// 時刻 / 日時を表す列名の候補。優先度順（boarding > payment > datetime > time > hour）。
// matching-animation の便割り当ては「乗車時刻」が必要なので boarding_at を優先する。
const TIME_COL_CANDIDATES = [
  // 乗車時刻系（最優先）
  'boarding_at', 'boarding_time',
  // 日時 / タイムスタンプ
  'payment_at', 'alighting_at', 'alighting_time',
  'record_at', 'recorded_at', 'operated_at', 'datetime', 'timestamp',
  'taken_at', 'used_at',
  // JP
  '日時', 'タイムスタンプ', '乗車日時', '降車日時',
  '発車時刻', '到着時刻', '出発時刻',
  '発車時間', '到着時間', '出発時間',
  '時刻', '時間',
  // 時刻のみ
  'time', 'hour', 'time_band',
];

// 日付列の候補。優先度順。
const DATE_COL_CANDIDATES = [
  // 日付＋専用接尾辞
  'boarding_date', 'service_date', 'operation_date', 'record_date', 'recorded_date',
  'travel_date', 'trip_date',
  // JP
  '乗車日', '運行日', '運転日', '日付', '年月日', '日次',
  // 単独
  'date',
];

function detectDateCol(headers: string[]): string | null {
  const lcHeaders = headers.map(h => ({ raw: h, lc: h.trim().toLowerCase() }));
  for (const name of DATE_COL_CANDIDATES) {
    const target = name.toLowerCase();
    const exact = lcHeaders.find(h => h.lc === target);
    if (exact) return exact.raw;
  }
  // 部分一致フォールバック（曖昧なので限定的に）
  const partials = ['_date', '運行日', '日付'];
  for (const pat of partials) {
    const target = pat.toLowerCase();
    const partial = lcHeaders.find(h => h.lc.includes(target));
    if (partial) return partial.raw;
  }
  return null;
}

function detectTimeCol(headers: string[]): string | null {
  const lcHeaders = headers.map(h => ({ raw: h, lc: h.trim().toLowerCase() }));
  for (const name of TIME_COL_CANDIDATES) {
    const target = name.toLowerCase();
    const exact = lcHeaders.find(h => h.lc === target);
    if (exact) return exact.raw;
  }
  // 部分一致フォールバック（より緩い）
  const partials = ['datetime', 'timestamp', 'payment_at', '_time', '日時', '時刻', '時間'];
  for (const pat of partials) {
    const target = pat.toLowerCase();
    const partial = lcHeaders.find(h => h.lc.includes(target));
    if (partial) return partial.raw;
  }
  return null;
}

// 各列の候補カラム名（英語/日本語）。優先度順に並べ、完全一致（大小文字無視）で検出する。
const STOP_CANDIDATES = [
  'station_name', 'station_code', 'stop_name', 'stop', 'stop_id', 'stop_code',
  '停留所名', '停留所', '停留所id', '停留所コード', 'バス停名', 'バス停', '駅名', '駅',
];
const BOARDING_STOP_CANDIDATES = [
  'boarding_station_name', 'boarding_station_code', 'boarding_stop_name', 'boarding_stop',
  'from_stop_name', 'from_stop', 'origin_stop', 'origin',
  '乗車停留所名', '乗車停留所', '乗車駅', '乗車バス停', '乗車地',
];
const ALIGHTING_STOP_CANDIDATES = [
  'alighting_station_name', 'alighting_station_code', 'alighting_stop_name', 'alighting_stop',
  'to_stop_name', 'to_stop', 'destination_stop', 'destination',
  '降車停留所名', '降車停留所', '降車駅', '降車バス停', '降車地',
];
const COUNT_ON_CANDIDATES = [
  'count_on', 'boarding_count', 'board_count', 'ons', 'boardings', 'on_count',
  '乗車人数', '乗車数', '乗車計', '乗車',
];
const COUNT_OFF_CANDIDATES = [
  'count_off', 'alighting_count', 'alight_count', 'offs', 'alightings', 'off_count',
  '降車人数', '降車数', '降車計', '降車',
];
const COUNT_CANDIDATES = [
  'count', 'passenger_count', 'ridership', 'riders', 'num_passengers', 'total',
  '利用者数', '乗降人数', '乗降数', '人数', '件数', '合計',
];
const ROUTE_CANDIDATES = [
  'boarding_route_name', 'route_name', 'route_long_name', 'route_short_name',
  'boarding_route_id', 'route_id', 'line_name', 'line',
  '路線名', '路線', '系統名', '系統', '路線id', '系統id',
];
const AGENCY_CANDIDATES = [
  'operating_agency_name', 'operating_agency_code', 'agency_name', 'agency_id', 'agency', 'operator',
  '事業者名', '事業者', '運行事業者', '運行会社', '会社名',
];
const TRIP_ID_CANDIDATES = [
  'trip_id', 'trip', 'course_id', 'diagram_id',
  '便id', '便', '便番号', '便no', 'ダイヤ',
];
const PASS_THROUGH_CANDIDATES = [
  'pass_through_count', 'passthrough_count', 'onboard_count', 'onboard', 'through_count',
  '通過人数', '通過', '車内人数', '乗車中人数',
];

/** 候補リストから、ヘッダーに完全一致（trim + 大小文字無視）する最初の列名を返す。 */
function findByCandidates(headers: string[], candidates: string[]): string | null {
  const lcHeaders = headers.map(h => ({ raw: h, lc: h.trim().toLowerCase() }));
  for (const cand of candidates) {
    const target = cand.trim().toLowerCase();
    const hit = lcHeaders.find(h => h.lc === target);
    if (hit) return hit.raw;
  }
  return null;
}

export function defaultFieldConfig(format: RidershipFormat, headers: string[]): RidershipFieldConfig {
  const lc = new Set(headers.map(h => h.trim().toLowerCase()));
  const find = (name: string) => headers.find(h => h.trim().toLowerCase() === name) ?? null;
  const pick = (cands: string[]) => findByCandidates(headers, cands);
  const timeColAuto = detectTimeCol(headers);
  const dateColAuto = detectDateCol(headers);

  switch (format) {
    case 'commons-detail':
      return {
        boardingStopCol: pick(BOARDING_STOP_CANDIDATES),
        alightingStopCol: pick(ALIGHTING_STOP_CANDIDATES),
        stopGtfsField: 'stop_name',
        // COMmmmONS は boarding_route_id を GTFS route_id と直接対応させる仕様。
        routeCol: find('boarding_route_id') ?? find('boarding_route_name'),
        routeGtfsField: 'route_id',
        agencyCol: pick(AGENCY_CANDIDATES),
        agencyGtfsField: 'agency_name',
        countCols: [
          'adult_passenger_count',
          'adult_challenged_passenger_count',
          'child_passenger_count',
          'child_challenged_passenger_count',
        ].filter(c => lc.has(c)),
        countOnCol: null,
        countOffCol: null,
        tripIdCol: null,
        passThroughCol: null,
        timeCol: timeColAuto,
        dateCol: dateColAuto,
      };
    case 'station-aggregate':
      return {
        boardingStopCol: pick(STOP_CANDIDATES),
        alightingStopCol: null,
        stopGtfsField: 'stop_name',
        routeCol: null,
        routeGtfsField: 'route_long_name',
        agencyCol: null,
        agencyGtfsField: 'agency_name',
        countCols: [],
        countOnCol: pick(COUNT_ON_CANDIDATES),
        countOffCol: pick(COUNT_OFF_CANDIDATES),
        tripIdCol: null,
        passThroughCol: null,
        timeCol: timeColAuto,
        dateCol: dateColAuto,
      };
    case 'od-aggregate':
      return {
        boardingStopCol: pick(BOARDING_STOP_CANDIDATES),
        alightingStopCol: pick(ALIGHTING_STOP_CANDIDATES),
        stopGtfsField: 'stop_name',
        routeCol: pick(ROUTE_CANDIDATES),
        routeGtfsField: 'route_long_name',
        agencyCol: pick(AGENCY_CANDIDATES),
        agencyGtfsField: 'agency_name',
        countCols: [pick(COUNT_CANDIDATES)].filter((c): c is string => c !== null),
        countOnCol: null,
        countOffCol: null,
        tripIdCol: null,
        passThroughCol: null,
        timeCol: timeColAuto,
        dateCol: dateColAuto,
      };
    case 'route-aggregate':
      return {
        boardingStopCol: null,
        alightingStopCol: null,
        stopGtfsField: 'stop_name',
        routeCol: pick(ROUTE_CANDIDATES),
        routeGtfsField: 'route_long_name',
        agencyCol: pick(AGENCY_CANDIDATES),
        agencyGtfsField: 'agency_name',
        countCols: [pick(COUNT_CANDIDATES)].filter((c): c is string => c !== null),
        countOnCol: null,
        countOffCol: null,
        tripIdCol: null,
        passThroughCol: null,
        timeCol: timeColAuto,
        dateCol: dateColAuto,
      };
    case 'detail':
      return {
        boardingStopCol: pick(BOARDING_STOP_CANDIDATES),
        alightingStopCol: pick(ALIGHTING_STOP_CANDIDATES),
        stopGtfsField: 'stop_name',
        routeCol: pick(ROUTE_CANDIDATES),
        routeGtfsField: 'route_long_name',
        agencyCol: pick(AGENCY_CANDIDATES),
        agencyGtfsField: 'agency_name',
        countCols: [pick(COUNT_CANDIDATES)].filter((c): c is string => c !== null),
        countOnCol: null,
        countOffCol: null,
        tripIdCol: null,
        passThroughCol: null,
        timeCol: timeColAuto,
        dateCol: dateColAuto,
      };
    case 'stop-trip-detail':
      return {
        boardingStopCol: pick(STOP_CANDIDATES),
        alightingStopCol: null,
        stopGtfsField: 'stop_name',
        routeCol: pick(ROUTE_CANDIDATES),
        routeGtfsField: 'route_long_name',
        agencyCol: null,
        agencyGtfsField: 'agency_name',
        countCols: [],
        countOnCol: pick(COUNT_ON_CANDIDATES),
        countOffCol: pick(COUNT_OFF_CANDIDATES),
        tripIdCol: pick(TRIP_ID_CANDIDATES),
        passThroughCol: pick(PASS_THROUGH_CANDIDATES),
        timeCol: timeColAuto,
        dateCol: dateColAuto,
      };
    default:
      return {
        boardingStopCol: null,
        alightingStopCol: null,
        stopGtfsField: 'stop_name',
        routeCol: null,
        routeGtfsField: 'route_long_name',
        agencyCol: null,
        agencyGtfsField: 'agency_name',
        countCols: [],
        countOnCol: null,
        countOffCol: null,
        tripIdCol: null,
        passThroughCol: null,
        timeCol: timeColAuto,
        dateCol: dateColAuto,
      };
  }
}
