import type { AsyncDuckDB } from '@duckdb/duckdb-wasm';
import { tableExists, columnExists } from './loader';
import type { RidershipFieldConfig, JoinStats, RouteGtfsField, AgencyGtfsField, StopGtfsField, CandidateGroup } from '../ridership/types';
import type { ReconciliationMode } from '../ridership/types';

function coerceRow(row: unknown): Record<string, unknown> {
  const obj = (row as { toJSON: () => Record<string, unknown> }).toJSON();
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'bigint') obj[key] = Number(obj[key]);
  }
  return obj;
}

function esc(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

export async function queryDistinctOdValues(
  db: AsyncDuckDB,
  columns: string[],
  nameColumns?: (string | null)[],
): Promise<{ code: string; name: string }[]> {
  if (columns.length === 0) return [];
  const conn = await db.connect();
  try {
    const parts = columns.map((col, i) => {
      const nameCol = nameColumns?.[i];
      const nameExpr = nameCol
        ? `COALESCE(CAST(${esc(nameCol)} AS VARCHAR), CAST(${esc(col)} AS VARCHAR))`
        : `CAST(${esc(col)} AS VARCHAR)`;
      return `
        SELECT DISTINCT CAST(${esc(col)} AS VARCHAR) AS code, ${nameExpr} AS name
        FROM ridership WHERE ${esc(col)} IS NOT NULL AND CAST(${esc(col)} AS VARCHAR) != ''
      `;
    });
    const sql = parts.join(' UNION ');
    const result = await conn.query(sql);
    return result.toArray().map(r => {
      const o = coerceRow(r);
      return { code: String(o.code ?? ''), name: String(o.name ?? '') };
    });
  } finally {
    await conn.close();
  }
}

export async function queryGtfsStopsForMatch(db: AsyncDuckDB): Promise<{ id: string; name: string }[]> {
  const conn = await db.connect();
  try {
    const result = await conn.query(`SELECT CAST(stop_id AS VARCHAR) AS id, CAST(stop_name AS VARCHAR) AS name FROM stops`);
    return result.toArray().map(r => {
      const o = coerceRow(r);
      return { id: String(o.id ?? ''), name: String(o.name ?? '') };
    });
  } finally {
    await conn.close();
  }
}

export async function queryGtfsStopGroups(
  db: AsyncDuckDB,
  matchField: StopGtfsField = 'stop_id',
): Promise<CandidateGroup[]> {
  const conn = await db.connect();
  try {
    if (matchField === 'stop_name') {
      const result = await conn.query(`
        SELECT CAST(s.stop_name AS VARCHAR) AS name,
               COUNT(*) AS cnt
        FROM stops s
        GROUP BY s.stop_name
      `);
      return result.toArray().map(r => {
        const o = coerceRow(r);
        const n = String(o.name ?? '');
        const cnt = Number(o.cnt ?? 1);
        return {
          groupId: n,
          groupName: cnt > 1 ? `${n} (${cnt})` : n,
          entries: [{ id: n, name: n }],
        };
      });
    }

    const result = await conn.query(`
      SELECT CAST(s.stop_id AS VARCHAR) AS id,
             CAST(s.stop_name AS VARCHAR) AS name
      FROM stops s
    `);
    return result.toArray().map(r => {
      const o = coerceRow(r);
      const id = String(o.id ?? '');
      const name = String(o.name ?? '');
      return { groupId: id, groupName: name, entries: [{ id, name }] };
    });
  } finally {
    await conn.close();
  }
}

export async function queryGtfsRoutesForMatch(
  db: AsyncDuckDB,
  routeGtfsField: RouteGtfsField = 'route_id',
): Promise<{ id: string; name: string }[]> {
  const conn = await db.connect();
  try {
    const idExpr = `COALESCE(CAST(${esc(routeGtfsField)} AS VARCHAR), '')`;
    const nameExpr = routeGtfsField === 'route_id'
      ? `COALESCE(CAST(route_short_name AS VARCHAR), CAST(route_long_name AS VARCHAR), '')`
      : `COALESCE(CAST(${esc(routeGtfsField)} AS VARCHAR), '')`;
    const result = await conn.query(`SELECT ${idExpr} AS id, ${nameExpr} AS name FROM routes`);
    return result.toArray().map(r => {
      const o = coerceRow(r);
      return { id: String(o.id ?? ''), name: String(o.name ?? '') };
    });
  } finally {
    await conn.close();
  }
}

export async function queryGtfsAgenciesForMatch(
  db: AsyncDuckDB,
  agencyGtfsField: AgencyGtfsField = 'agency_id',
): Promise<{ id: string; name: string }[]> {
  const conn = await db.connect();
  try {
    const idExpr = `COALESCE(CAST(${esc(agencyGtfsField)} AS VARCHAR), '')`;
    const nameExpr = agencyGtfsField === 'agency_id'
      ? `COALESCE(CAST(agency_name AS VARCHAR), '')`
      : `COALESCE(CAST(${esc(agencyGtfsField)} AS VARCHAR), '')`;
    const result = await conn.query(`SELECT ${idExpr} AS id, ${nameExpr} AS name FROM agency`);
    return result.toArray().map(r => {
      const o = coerceRow(r);
      return { id: String(o.id ?? ''), name: String(o.name ?? '') };
    });
  } finally {
    await conn.close();
  }
}

function buildCountExpr(config: RidershipFieldConfig, alias: string): string {
  if (config.countCols.length > 0) {
    return config.countCols
      .map(c => `COALESCE(TRY_CAST(${alias}.${esc(c)} AS INTEGER), 0)`)
      .join(' + ');
  }
  return '1';
}

function buildHourExpr(timeCol: string | null, alias: string): string {
  if (!timeCol) return 'CAST(NULL AS INTEGER)';
  const s = `CAST(${alias}.${esc(timeCol)} AS VARCHAR)`;
  return `COALESCE(
    TRY_CAST(SPLIT_PART(SPLIT_PART(${s}, 'T', 2), ':', 1) AS INTEGER),
    TRY_CAST(SPLIT_PART(SPLIT_PART(${s}, ' ', 2), ':', 1) AS INTEGER),
    TRY_CAST(SPLIT_PART(${s}, ':', 1) AS INTEGER),
    TRY_CAST(${s} AS INTEGER)
  )`;
}

/** 文字列時刻列から分単位の "minute of day" を返す SQL 式（HH*60+MM）。 */
function buildMinuteOfDayExpr(timeCol: string | null, alias: string): string {
  if (!timeCol) return 'CAST(NULL AS INTEGER)';
  const s = `CAST(${alias}.${esc(timeCol)} AS VARCHAR)`;
  const timeOnly = `COALESCE(
    NULLIF(SPLIT_PART(${s}, 'T', 2), ''),
    NULLIF(SPLIT_PART(${s}, ' ', 2), ''),
    ${s}
  )`;
  return `(
    COALESCE(TRY_CAST(SPLIT_PART(${timeOnly}, ':', 1) AS INTEGER), 0) * 60
    + COALESCE(TRY_CAST(SPLIT_PART(${timeOnly}, ':', 2) AS INTEGER), 0)
  )`;
}

/** GTFS の HH:MM:SS 列を分単位の minute of day に変換（HH は 24+ もあり得る）。 */
function buildGtfsMinuteOfDayExpr(colExpr: string): string {
  const s = `CAST(${colExpr} AS VARCHAR)`;
  return `(
    COALESCE(TRY_CAST(SPLIT_PART(${s}, ':', 1) AS INTEGER), 0) * 60
    + COALESCE(TRY_CAST(SPLIT_PART(${s}, ':', 2) AS INTEGER), 0)
  )`;
}

/** GTFS の HH:MM:SS 列を秒単位の second of day に変換（HH は 24+ もあり得る）。 */
function buildGtfsSecondOfDayExpr(colExpr: string): string {
  const s = `CAST(${colExpr} AS VARCHAR)`;
  return `(
    COALESCE(TRY_CAST(SPLIT_PART(${s}, ':', 1) AS INTEGER), 0) * 3600
    + COALESCE(TRY_CAST(SPLIT_PART(${s}, ':', 2) AS INTEGER), 0) * 60
    + COALESCE(TRY_CAST(SPLIT_PART(${s}, ':', 3) AS INTEGER), 0)
  )`;
}

/**
 * 文字列を様々な日付フォーマットからパースし DATE を返す SQL 式。
 * 対応: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, YYYYMMDD, MM/DD/YYYY, DD/MM/YYYY
 */
function buildNormalizeDateExpr(colExpr: string): string {
  return `(
    COALESCE(
      TRY_CAST(${colExpr} AS DATE),
      TRY_CAST(STRPTIME(${colExpr}, '%Y/%m/%d') AS DATE),
      TRY_CAST(STRPTIME(${colExpr}, '%Y.%m.%d') AS DATE),
      TRY_CAST(STRPTIME(${colExpr}, '%Y%m%d') AS DATE),
      TRY_CAST(STRPTIME(${colExpr}, '%m/%d/%Y') AS DATE),
      TRY_CAST(STRPTIME(${colExpr}, '%d/%m/%Y') AS DATE)
    )
  )`;
}

/**
 * 乗降実績の dateCol / timeCol から YYYY-MM-DD を抽出する SQL 式。
 * - dateCol が設定済: 正規化して使用（複数フォーマット対応）
 * - dateCol 未設定: timeCol のプレフィックスから抽出
 * - どちらも無し: NULL
 */
function buildDateExpr(dateCol: string | null, timeCol: string | null, alias: string): string {
  if (dateCol) {
    const s = `CAST(${alias}.${esc(dateCol)} AS VARCHAR)`;
    return `CAST(${buildNormalizeDateExpr(s)} AS VARCHAR)`;
  }
  if (!timeCol) return 'CAST(NULL AS VARCHAR)';
  const s = `CAST(${alias}.${esc(timeCol)} AS VARCHAR)`;
  return `(
    CASE
      WHEN POSITION('T' IN ${s}) > 0
           AND TRY_CAST(SPLIT_PART(${s}, 'T', 1) AS DATE) IS NOT NULL
        THEN SPLIT_PART(${s}, 'T', 1)
      WHEN POSITION(' ' IN ${s}) > 0
           AND TRY_CAST(SPLIT_PART(${s}, ' ', 1) AS DATE) IS NOT NULL
        THEN SPLIT_PART(${s}, ' ', 1)
      WHEN TRY_CAST(${s} AS DATE) IS NOT NULL
        THEN ${s}
      ELSE NULL
    END
  )`;
}

/**
 * (date, service_id) サービス稼働判定 CTE を返す。trips レイヤー (queryTripsForDate) と同じロジック。
 * - calendar.txt: 曜日 × 日付範囲で判定
 * - calendar_dates.txt exception_type=1: 追加運行
 * - calendar_dates.txt exception_type=2: 運行中止（除外）
 *
 * 戻り値は WITH 句の中身のみ。空文字を返した場合はフィルタ無し。
 */
function buildEligibleServiceCte(
  hasCalendar: boolean,
  hasCalendarDates: boolean,
  fallbackDate: string,
): string {
  if (!hasCalendar && !hasCalendarDates) return '';

  // distinct_dates: ridership に現れる日付（NULL は fallback に集約）
  const distinctDates = `
    distinct_dates AS (
      SELECT DISTINCT COALESCE(date_str, '${fallbackDate}') AS date_str
      FROM ridership_indexed
    )`;

  // 曜日インデックス (DuckDB ISODOW: 1=Mon..7=Sun) → calendar 列名
  // ※ DuckDB の DOW は 0=Sunday..6=Saturday、ISODOW は 1=Monday..7=Sunday なので DOW を使う
  const dayColCase = `(
    CASE EXTRACT(DOW FROM TRY_CAST(d.date_str AS DATE))
      WHEN 0 THEN c.sunday
      WHEN 1 THEN c.monday
      WHEN 2 THEN c.tuesday
      WHEN 3 THEN c.wednesday
      WHEN 4 THEN c.thursday
      WHEN 5 THEN c.friday
      WHEN 6 THEN c.saturday
    END = 1
  )`;
  const dateNum = `REPLACE(d.date_str, '-', '')`;

  // calendar.txt ベースのアクティブな (date, service_id)
  const calendarBase = hasCalendar ? `
    SELECT DISTINCT d.date_str, CAST(c.service_id AS VARCHAR) AS service_id
    FROM distinct_dates d
    CROSS JOIN calendar c
    WHERE ${dayColCase}
      AND CAST(c.start_date AS VARCHAR) <= ${dateNum}
      AND CAST(c.end_date AS VARCHAR) >= ${dateNum}
  ` : '';

  // calendar_dates.txt exception_type=1 で追加運行
  const calendarDatesAdds = hasCalendarDates ? `
    SELECT DISTINCT d.date_str, CAST(cd.service_id AS VARCHAR) AS service_id
    FROM distinct_dates d
    JOIN calendar_dates cd
      ON CAST(cd.date AS VARCHAR) = ${dateNum.replace(/d\.date_str/g, 'd.date_str')}
     AND CAST(cd.exception_type AS INTEGER) = 1
  ` : '';

  const unionParts: string[] = [];
  if (calendarBase) unionParts.push(calendarBase);
  if (calendarDatesAdds) unionParts.push(calendarDatesAdds);
  const baseUnion = unionParts.join('\n      UNION\n      ');

  // exception_type=2 で除外
  const exclusionFilter = hasCalendarDates ? `
    WHERE NOT EXISTS (
      SELECT 1 FROM calendar_dates cd
      WHERE CAST(cd.service_id AS VARCHAR) = base.service_id
        AND CAST(cd.date AS VARCHAR) = REPLACE(base.date_str, '-', '')
        AND CAST(cd.exception_type AS INTEGER) = 2
    )` : '';

  return `
      ${distinctDates},
      eligible_service_base AS (
        ${baseUnion}
      ),
      eligible_service AS (
        SELECT base.date_str, base.service_id
        FROM eligible_service_base base
        ${exclusionFilter}
      )`;
}

/** 日付文字列とフォールバック日付から UTC 0:00 の unix 秒を返す SQL 式。
 *  入力日付は様々なフォーマットを受け付ける。 */
function buildEpochFromDateExpr(dateColExpr: string, fallbackDate: string): string {
  return `(
    COALESCE(
      EPOCH(${buildNormalizeDateExpr(dateColExpr)}),
      EPOCH(CAST('${fallbackDate}' AS DATE))
    )
  )`;
}

/** Hourly + period SUM(...) expressions wrapping a per-row numeric value. */
function buildHourlySumCols(perRowExpr: string, hourExpr: string, prefix: string): string[] {
  const cols: string[] = [];
  for (let h = 4; h <= 27; h++) {
    const padded = String(h).padStart(2, '0');
    cols.push(`SUM(CASE WHEN ${hourExpr} = ${h} THEN ${perRowExpr} ELSE 0 END) AS ${prefix}_${padded}`);
  }
  cols.push(`SUM(CASE WHEN ${hourExpr} BETWEEN 4 AND 8 THEN ${perRowExpr} ELSE 0 END) AS ${prefix}_morning`);
  cols.push(`SUM(CASE WHEN ${hourExpr} BETWEEN 9 AND 16 THEN ${perRowExpr} ELSE 0 END) AS ${prefix}_daytime`);
  cols.push(`SUM(CASE WHEN ${hourExpr} BETWEEN 17 AND 20 THEN ${perRowExpr} ELSE 0 END) AS ${prefix}_evening`);
  cols.push(`SUM(CASE WHEN ${hourExpr} BETWEEN 21 AND 27 THEN ${perRowExpr} ELSE 0 END) AS ${prefix}_latenight`);
  return cols;
}

const HOUR_KEYS: string[] = (() => {
  const arr: string[] = ['morning', 'daytime', 'evening', 'latenight'];
  for (let h = 4; h <= 27; h++) arr.push(String(h).padStart(2, '0'));
  return arr;
})();

export { HOUR_KEYS };

export async function executeRidershipJoin(
  db: AsyncDuckDB,
  config: RidershipFieldConfig,
  mode: ReconciliationMode,
): Promise<JoinStats> {
  const conn = await db.connect();
  try {
    const hasStopMap = mode !== 'direct' && await tableExists(db, 'stop_mapping');
    const hasRouteMap = mode !== 'direct' && await tableExists(db, 'route_mapping');

    const countExpr = buildCountExpr(config, 'r');
    const stopField = esc(config.stopGtfsField);
    const routeField = esc(config.routeGtfsField);
    const hourExpr = buildHourExpr(config.timeCol, 'r');

    // ── ridership_by_stop ──────────────────────────
    await conn.query(`DROP TABLE IF EXISTS ridership_by_stop`);
    await conn.query(`DROP TABLE IF EXISTS ridership_allcols_by_stop`);

    if (config.boardingStopCol) {
      const boardCol = esc(config.boardingStopCol);
      const alightCol = config.alightingStopCol ? esc(config.alightingStopCol) : null;

      const stopJoinOn = hasStopMap
        ? `JOIN stop_mapping smb ON CAST(r.${boardCol} AS VARCHAR) = smb.od_value`
        : '';
      const stopIdOn = hasStopMap ? 'smb.gtfs_value' : `CAST(r.${boardCol} AS VARCHAR)`;

      if (alightCol) {
        const stopJoinOff = hasStopMap
          ? `JOIN stop_mapping sma ON CAST(r.${alightCol} AS VARCHAR) = sma.od_value`
          : '';
        const stopIdOff = hasStopMap ? 'sma.gtfs_value' : `CAST(r.${alightCol} AS VARCHAR)`;

        const onPerRow = config.countOnCol
          ? `COALESCE(TRY_CAST(r.${esc(config.countOnCol)} AS INTEGER), 0)`
          : countExpr;
        const offPerRow = config.countOffCol
          ? `COALESCE(TRY_CAST(r.${esc(config.countOffCol)} AS INTEGER), 0)`
          : countExpr;
        const onTotal = `SUM(${onPerRow})`;
        const offTotal = `SUM(${offPerRow})`;
        const onHourlyCols = buildHourlySumCols(onPerRow, hourExpr, 'on');
        const offHourlyCols = buildHourlySumCols(offPerRow, hourExpr, 'off');
        const ridershipHourlyExprs = HOUR_KEYS.map(
          k => `COALESCE(b.on_${k}, 0) + COALESCE(a.off_${k}, 0) AS ridership_${k}`,
        );

        await conn.query(`
          CREATE TABLE ridership_by_stop AS
          WITH boarding AS (
            SELECT ${stopIdOn} AS gtfs_stop_val,
                   ${onTotal} AS count_on,
                   ${onHourlyCols.join(',\n                   ')}
            FROM ridership r ${stopJoinOn}
            WHERE ${stopIdOn} IS NOT NULL
            GROUP BY ${stopIdOn}
          ),
          alighting AS (
            SELECT ${stopIdOff} AS gtfs_stop_val,
                   ${offTotal} AS count_off,
                   ${offHourlyCols.join(',\n                   ')}
            FROM ridership r ${stopJoinOff}
            WHERE ${stopIdOff} IS NOT NULL
            GROUP BY ${stopIdOff}
          )
          SELECT COALESCE(b.gtfs_stop_val, a.gtfs_stop_val) AS gtfs_stop_val,
                 COALESCE(b.count_on, 0) AS count_on,
                 COALESCE(a.count_off, 0) AS count_off,
                 ${ridershipHourlyExprs.join(',\n                 ')}
          FROM boarding b FULL OUTER JOIN alighting a ON b.gtfs_stop_val = a.gtfs_stop_val
        `);
      } else {
        const onPerRow = config.countOnCol
          ? `COALESCE(TRY_CAST(r.${esc(config.countOnCol)} AS INTEGER), 0)`
          : countExpr;
        const offPerRow = config.countOffCol
          ? `COALESCE(TRY_CAST(r.${esc(config.countOffCol)} AS INTEGER), 0)`
          : '0';
        const onTotal = `SUM(${onPerRow})`;
        const offTotal = config.countOffCol ? `SUM(${offPerRow})` : '0';
        const totalPerRow = config.countOffCol ? `(${onPerRow} + ${offPerRow})` : onPerRow;
        const ridershipHourlyCols = buildHourlySumCols(totalPerRow, hourExpr, 'ridership');

        await conn.query(`
          CREATE TABLE ridership_by_stop AS
          SELECT ${stopIdOn} AS gtfs_stop_val,
                 ${onTotal} AS count_on,
                 ${offTotal} AS count_off,
                 ${ridershipHourlyCols.join(',\n                 ')}
          FROM ridership r ${stopJoinOn}
          WHERE ${stopIdOn} IS NOT NULL
          GROUP BY ${stopIdOn}
        `);
      }

      // 「すべてのカラムを結合する」用: GTFS 停留所値ごとに CSV 行の全列を保持する。
      // 重複キーは先頭行を採用（ROW_NUMBER で __rn=1 を選択）。
      await conn.query(`
        CREATE TABLE ridership_allcols_by_stop AS
        SELECT * EXCLUDE (__rn)
        FROM (
          SELECT ${stopIdOn} AS __gtfs_stop_val,
                 r.*,
                 ROW_NUMBER() OVER (PARTITION BY ${stopIdOn}) AS __rn
          FROM ridership r ${stopJoinOn}
          WHERE ${stopIdOn} IS NOT NULL
        )
        WHERE __rn = 1
      `);
    }

    // ── ridership_by_route ─────────────────────────
    await conn.query(`DROP TABLE IF EXISTS ridership_by_route`);
    await conn.query(`DROP TABLE IF EXISTS ridership_allcols_by_route`);

    if (config.routeCol) {
      const routeColE = esc(config.routeCol);
      const routeJoin = hasRouteMap
        ? `JOIN route_mapping rm ON CAST(r.${routeColE} AS VARCHAR) = rm.od_value`
        : '';
      const routeId = hasRouteMap ? 'rm.gtfs_value' : `CAST(r.${routeColE} AS VARCHAR)`;

      const routeHourlyCols = buildHourlySumCols(countExpr, hourExpr, 'ridership');

      await conn.query(`
        CREATE TABLE ridership_by_route AS
        SELECT ${routeId} AS gtfs_route_val,
               SUM(${countExpr}) AS ridership_count,
               ${routeHourlyCols.join(',\n               ')}
        FROM ridership r ${routeJoin}
        WHERE ${routeId} IS NOT NULL
        GROUP BY ${routeId}
      `);

      // 「すべてのカラムを結合する」用: GTFS 系統値ごとに CSV 行の全列を保持（先頭行採用）。
      await conn.query(`
        CREATE TABLE ridership_allcols_by_route AS
        SELECT * EXCLUDE (__rn)
        FROM (
          SELECT ${routeId} AS __gtfs_route_val,
                 r.*,
                 ROW_NUMBER() OVER (PARTITION BY ${routeId}) AS __rn
          FROM ridership r ${routeJoin}
          WHERE ${routeId} IS NOT NULL
        )
        WHERE __rn = 1
      `);
    }

    // ── ridership_by_segment ───────────────────────
    await conn.query(`DROP TABLE IF EXISTS ridership_by_segment`);

    if (config.boardingStopCol && config.alightingStopCol) {
      // OD-style ridership_by_segment:
      //   各 OD ペアを GTFS の路線停留所列に沿って隣接区間に展開し、
      //   通過する全区間に乗客数を積み上げる。direction_id がある場合は
      //   方向別に正準 trip を選び、両方向の区間それぞれで集計する。
      const boardCol = esc(config.boardingStopCol);
      const alightCol = esc(config.alightingStopCol);

      const stopJoinOn = hasStopMap
        ? `JOIN stop_mapping smb ON CAST(r.${boardCol} AS VARCHAR) = smb.od_value`
        : '';
      const stopJoinOff = hasStopMap
        ? `JOIN stop_mapping sma ON CAST(r.${alightCol} AS VARCHAR) = sma.od_value`
        : '';
      const stopIdOn = hasStopMap ? 'smb.gtfs_value' : `CAST(r.${boardCol} AS VARCHAR)`;
      const stopIdOff = hasStopMap ? 'sma.gtfs_value' : `CAST(r.${alightCol} AS VARCHAR)`;
      const matchField = esc(config.stopGtfsField);

      // direction_id が trips にあれば (route_id, direction_id) で方向別に正準 trip を選択。
      // shape_id があればさらに変形パターンを区別する。
      const hasDirection = await columnExists(db, 'trips', 'direction_id');
      const hasShapeId = await columnExists(db, 'trips', 'shape_id');
      const dirExpr = hasDirection
        ? `COALESCE(CAST(t.direction_id AS VARCHAR), '_')`
        : `'_'`;
      const shapeExpr = hasShapeId
        ? `COALESCE(CAST(t.shape_id AS VARCHAR), '_')`
        : `'_'`;

      const odHourlyCols = buildHourlySumCols(countExpr, hourExpr, 'ridership');
      const hourlyCarryForward = HOUR_KEYS.map(k => `od.ridership_${k}`).join(', ');
      const hourlyCarryExpand = HOUR_KEYS.map(k => `chosen.ridership_${k}`).join(', ');
      const hourlyFinalSums = HOUR_KEYS
        .map(k => `SUM(ridership_${k}) AS ridership_${k}`)
        .join(',\n              ');

      await conn.query(`
        CREATE TABLE ridership_by_segment AS
        WITH canonical_trip AS (
          SELECT route_id, dir_key, trip_id FROM (
            SELECT
              CAST(t.route_id AS VARCHAR) AS route_id,
              ${dirExpr} || '|' || ${shapeExpr} AS dir_key,
              CAST(t.trip_id AS VARCHAR) AS trip_id,
              ROW_NUMBER() OVER (
                PARTITION BY CAST(t.route_id AS VARCHAR),
                             ${dirExpr} || '|' || ${shapeExpr}
                ORDER BY COUNT(*) DESC, CAST(t.trip_id AS VARCHAR)
              ) AS rn
            FROM trips t
            JOIN stop_times st ON CAST(t.trip_id AS VARCHAR) = CAST(st.trip_id AS VARCHAR)
            GROUP BY CAST(t.route_id AS VARCHAR),
                     ${dirExpr} || '|' || ${shapeExpr},
                     CAST(t.trip_id AS VARCHAR)
          ) x WHERE rn = 1
        ),
        route_stops AS (
          -- GTFS の stop_sequence は飛び番（例: 14 → 17）が許容されるため、
          -- LEAD で順序上の次停留所を取得する。
          SELECT
            ct.route_id,
            ct.dir_key,
            CAST(st.stop_id AS VARCHAR) AS stop_id,
            CAST(s.${matchField} AS VARCHAR) AS stop_val,
            CAST(st.stop_sequence AS INTEGER) AS stop_sequence,
            LEAD(CAST(s.${matchField} AS VARCHAR)) OVER (
              PARTITION BY ct.route_id, ct.dir_key
              ORDER BY CAST(st.stop_sequence AS INTEGER)
            ) AS next_stop_val
          FROM canonical_trip ct
          JOIN stop_times st ON CAST(ct.trip_id AS VARCHAR) = CAST(st.trip_id AS VARCHAR)
          JOIN stops s ON CAST(st.stop_id AS VARCHAR) = CAST(s.stop_id AS VARCHAR)
        ),
        ridership_od AS (
          SELECT
            ${stopIdOn} AS b_val,
            ${stopIdOff} AS a_val,
            SUM(${countExpr}) AS pax,
            ${odHourlyCols.join(',\n            ')}
          FROM ridership r ${stopJoinOn} ${stopJoinOff}
          WHERE ${stopIdOn} IS NOT NULL AND ${stopIdOff} IS NOT NULL
            AND ${stopIdOn} != ${stopIdOff}
          GROUP BY ${stopIdOn}, ${stopIdOff}
        ),
        od_with_route AS (
          SELECT
            od.b_val, od.a_val, od.pax,
            ${hourlyCarryForward},
            rs1.route_id,
            rs1.dir_key,
            rs1.stop_sequence AS b_seq,
            rs2.stop_sequence AS a_seq,
            ROW_NUMBER() OVER (
              PARTITION BY od.b_val, od.a_val
              ORDER BY (rs2.stop_sequence - rs1.stop_sequence), rs1.route_id, rs1.dir_key
            ) AS rn
          FROM ridership_od od
          JOIN route_stops rs1 ON rs1.stop_val = od.b_val
          JOIN route_stops rs2
            ON rs2.route_id = rs1.route_id
           AND rs2.dir_key  = rs1.dir_key
           AND rs2.stop_val = od.a_val
          WHERE rs1.stop_sequence < rs2.stop_sequence
        ),
        chosen AS (SELECT * FROM od_with_route WHERE rn = 1),
        expanded AS (
          SELECT
            rs.stop_val AS from_stop_val,
            rs.next_stop_val AS to_stop_val,
            chosen.pax,
            ${hourlyCarryExpand}
          FROM chosen
          JOIN route_stops rs
            ON rs.route_id = chosen.route_id
           AND rs.dir_key  = chosen.dir_key
           AND rs.stop_sequence >= chosen.b_seq
           AND rs.stop_sequence <  chosen.a_seq
          WHERE rs.next_stop_val IS NOT NULL
        )
        SELECT
          from_stop_val,
          to_stop_val,
          SUM(pax) AS riders,
          ${hourlyFinalSums}
        FROM expanded
        GROUP BY from_stop_val, to_stop_val
      `);
    } else if (config.boardingStopCol && config.tripIdCol && config.timeCol) {
      const stopCol = esc(config.boardingStopCol);
      const tripCol = esc(config.tripIdCol);
      const routeCol = config.routeCol ? esc(config.routeCol) : null;

      const stopJoin = hasStopMap
        ? `JOIN stop_mapping sm ON CAST(r.${stopCol} AS VARCHAR) = sm.od_value`
        : '';
      const stopId = hasStopMap ? 'sm.gtfs_value' : `CAST(r.${stopCol} AS VARCHAR)`;

      const partitionKey = routeCol
        ? `CAST(r.${routeCol} AS VARCHAR) || '_' || CAST(r.${tripCol} AS VARCHAR)`
        : `CAST(r.${tripCol} AS VARCHAR)`;

      const passThroughExpr = config.passThroughCol
        ? `COALESCE(TRY_CAST(r.${esc(config.passThroughCol)} AS INTEGER), 0)`
        : `COALESCE(TRY_CAST(r.${esc(config.countOnCol!)} AS INTEGER), 0)`;

      // 便内の停留所順序は時刻列で決定
      const orderExpr = `CAST(r.${esc(config.timeCol)} AS VARCHAR)`;

      const segmentHourlyCols = buildHourlySumCols('pass_through', '_hour', 'ridership');

      await conn.query(`
        CREATE TABLE ridership_by_segment AS
        WITH ordered AS (
          SELECT
            ${stopId} AS gtfs_stop_val,
            ${partitionKey} AS trip_key,
            ${orderExpr} AS stop_order,
            ${passThroughExpr} AS pass_through,
            ${hourExpr} AS _hour
          FROM ridership r ${stopJoin}
          WHERE ${stopId} IS NOT NULL
        ),
        with_next AS (
          SELECT
            gtfs_stop_val AS from_stop_val,
            LEAD(gtfs_stop_val) OVER (PARTITION BY trip_key ORDER BY stop_order) AS to_stop_val,
            pass_through,
            _hour
          FROM ordered
        )
        SELECT from_stop_val, to_stop_val, SUM(pass_through) AS riders,
               ${segmentHourlyCols.join(',\n               ')}
        FROM with_next
        WHERE to_stop_val IS NOT NULL
        GROUP BY from_stop_val, to_stop_val
      `);
    }

    // ── ridership_by_flow (aggregated OD pairs) ────
    await conn.query(`DROP TABLE IF EXISTS ridership_by_flow`);
    await conn.query(`DROP TABLE IF EXISTS ridership_arc`);

    if (config.boardingStopCol && config.alightingStopCol) {
      const boardCol = esc(config.boardingStopCol);
      const alightCol = esc(config.alightingStopCol);

      const stopJoinOn = hasStopMap
        ? `JOIN stop_mapping smb2 ON CAST(r.${boardCol} AS VARCHAR) = smb2.od_value`
        : '';
      const stopJoinOff = hasStopMap
        ? `JOIN stop_mapping sma2 ON CAST(r.${alightCol} AS VARCHAR) = sma2.od_value`
        : '';
      const stopIdOn = hasStopMap ? 'smb2.gtfs_value' : `CAST(r.${boardCol} AS VARCHAR)`;
      const stopIdOff = hasStopMap ? 'sma2.gtfs_value' : `CAST(r.${alightCol} AS VARCHAR)`;

      const flowHourlyCols = buildHourlySumCols(countExpr, hourExpr, 'ridership');

      await conn.query(`
        CREATE TABLE ridership_by_flow AS
        SELECT
          bs.stop_id AS boarding_stop_id,
          CAST(bs.stop_name AS VARCHAR) AS boarding_stop_name,
          CAST(bs.stop_lon AS DOUBLE) AS boarding_lon,
          CAST(bs.stop_lat AS DOUBLE) AS boarding_lat,
          als.stop_id AS alighting_stop_id,
          CAST(als.stop_name AS VARCHAR) AS alighting_stop_name,
          CAST(als.stop_lon AS DOUBLE) AS alighting_lon,
          CAST(als.stop_lat AS DOUBLE) AS alighting_lat,
          SUM(${countExpr}) AS ridership,
          ${flowHourlyCols.join(',\n          ')}
        FROM ridership r
          ${stopJoinOn}
          ${stopJoinOff}
          JOIN stops bs ON CAST(bs.${stopField} AS VARCHAR) = ${stopIdOn}
          JOIN stops als ON CAST(als.${stopField} AS VARCHAR) = ${stopIdOff}
        WHERE ${stopIdOn} IS NOT NULL AND ${stopIdOff} IS NOT NULL
          AND ${stopIdOn} != ${stopIdOff}
        GROUP BY bs.stop_id, bs.stop_name, bs.stop_lon, bs.stop_lat,
                 als.stop_id, als.stop_name, als.stop_lon, als.stop_lat
      `);

      await conn.query(`
        CREATE TABLE ridership_arc AS
        SELECT
          bs.stop_id AS boarding_stop_id,
          CAST(bs.stop_name AS VARCHAR) AS boarding_stop_name,
          CAST(bs.stop_lon AS DOUBLE) AS boarding_lon,
          CAST(bs.stop_lat AS DOUBLE) AS boarding_lat,
          als.stop_id AS alighting_stop_id,
          CAST(als.stop_name AS VARCHAR) AS alighting_stop_name,
          CAST(als.stop_lon AS DOUBLE) AS alighting_lon,
          CAST(als.stop_lat AS DOUBLE) AS alighting_lat,
          (${countExpr}) AS passenger_count
        FROM ridership r
          ${stopJoinOn}
          ${stopJoinOff}
          JOIN stops bs ON CAST(bs.${stopField} AS VARCHAR) = ${stopIdOn}
          JOIN stops als ON CAST(als.${stopField} AS VARCHAR) = ${stopIdOff}
        WHERE ${stopIdOn} IS NOT NULL AND ${stopIdOff} IS NOT NULL
          AND ${stopIdOn} != ${stopIdOff}
      `);
    }

    // ── Stats ──────────────────────────────────────
    const hasStops = await tableExists(db, 'ridership_by_stop');
    const hasRoutes = await tableExists(db, 'ridership_by_route');

    let matched = 0;
    let unmatched = 0;
    let coverageStops = 0;
    let coverageRoutes = 0;

    if (hasStops) {
      const res = await conn.query(`
        SELECT COUNT(*) AS matched FROM ridership_by_stop rbs
        WHERE EXISTS (SELECT 1 FROM stops s WHERE CAST(s.${stopField} AS VARCHAR) = rbs.gtfs_stop_val)
      `);
      matched = Number(coerceRow(res.toArray()[0]!).matched);

      const total = await conn.query(`SELECT COUNT(*) AS cnt FROM ridership_by_stop`);
      const totalCount = Number(coerceRow(total.toArray()[0]!).cnt);
      unmatched = totalCount - matched;

      const stopsTotal = await conn.query(`
        SELECT COUNT(DISTINCT CAST(s.${stopField} AS VARCHAR)) AS cnt FROM stops s
      `);
      const stopsCount = Number(coerceRow(stopsTotal.toArray()[0]!).cnt);
      coverageStops = stopsCount > 0 ? Math.round((matched / stopsCount) * 100) : 0;
    }

    if (hasRoutes) {
      const res = await conn.query(`
        SELECT COUNT(*) AS matched FROM ridership_by_route rbr
        WHERE EXISTS (SELECT 1 FROM routes rt WHERE CAST(rt.${routeField} AS VARCHAR) = rbr.gtfs_route_val)
      `);
      const routeMatched = Number(coerceRow(res.toArray()[0]!).matched);

      const routesTotal = await conn.query(`
        SELECT COUNT(DISTINCT CAST(rt.${routeField} AS VARCHAR)) AS cnt FROM routes rt
      `);
      const routesCount = Number(coerceRow(routesTotal.toArray()[0]!).cnt);
      coverageRoutes = routesCount > 0 ? Math.round((routeMatched / routesCount) * 100) : 0;
    }

    return { matched, unmatched, coverageStops, coverageRoutes };
  } finally {
    await conn.close();
  }
}

export interface RidershipArcRow {
  boarding_stop_id: string;
  boarding_stop_name: string;
  boarding_lon: number;
  boarding_lat: number;
  alighting_stop_id: string;
  alighting_stop_name: string;
  alighting_lon: number;
  alighting_lat: number;
  value: number;
  hourly?: Record<string, number>;
}

export async function queryRidershipFlows(db: AsyncDuckDB): Promise<RidershipArcRow[]> {
  const conn = await db.connect();
  try {
    const res = await conn.query(`SELECT * FROM ridership_by_flow`);
    return res.toArray().map(r => {
      const o = coerceRow(r);
      const hourly: Record<string, number> = {};
      for (const k of HOUR_KEYS) {
        const v = o[`ridership_${k}`];
        if (v !== undefined && v !== null) hourly[`ridership_${k}`] = Number(v);
      }
      return {
        boarding_stop_id: String(o.boarding_stop_id),
        boarding_stop_name: String(o.boarding_stop_name ?? ''),
        boarding_lon: Number(o.boarding_lon),
        boarding_lat: Number(o.boarding_lat),
        alighting_stop_id: String(o.alighting_stop_id),
        alighting_stop_name: String(o.alighting_stop_name ?? ''),
        alighting_lon: Number(o.alighting_lon),
        alighting_lat: Number(o.alighting_lat),
        value: Number(o.ridership ?? 0),
        hourly,
      };
    });
  } finally {
    await conn.close();
  }
}

export async function queryRidershipArcs(db: AsyncDuckDB): Promise<RidershipArcRow[]> {
  const conn = await db.connect();
  try {
    const res = await conn.query(`SELECT * FROM ridership_arc`);
    return res.toArray().map(r => {
      const o = coerceRow(r);
      return {
        boarding_stop_id: String(o.boarding_stop_id),
        boarding_stop_name: String(o.boarding_stop_name ?? ''),
        boarding_lon: Number(o.boarding_lon),
        boarding_lat: Number(o.boarding_lat),
        alighting_stop_id: String(o.alighting_stop_id),
        alighting_stop_name: String(o.alighting_stop_name ?? ''),
        alighting_lon: Number(o.alighting_lon),
        alighting_lat: Number(o.alighting_lat),
        value: Number(o.passenger_count ?? 0),
      };
    });
  } finally {
    await conn.close();
  }
}

// ───────────────────────────────────────────────────────────
// Phase 1 / 2: matching-trips  (per-trip onboard counts)
// ───────────────────────────────────────────────────────────

/**
 * OD 形式の乗降実績を GTFS の特定 trip に割り当て、
 * 各 trip の各区間における onboard 数を計算する。
 * 出力テーブル: ridership_by_trip_segment
 *
 * 適用フォーマット: OD実績(COMmmmONS), 乗降実績(一件明細) — boarding/alighting stop + timeCol あり
 */
async function executeMatchingTripsForOD(
  db: AsyncDuckDB,
  config: RidershipFieldConfig,
  hasStopMap: boolean,
  fallbackDate: string,
): Promise<void> {
  if (!config.boardingStopCol || !config.alightingStopCol || !config.timeCol) return;
  if (!await tableExists(db, 'trips') || !await tableExists(db, 'stop_times')) return;

  const conn = await db.connect();
  try {
    const boardCol = esc(config.boardingStopCol);
    const alightCol = esc(config.alightingStopCol);
    const matchField = esc(config.stopGtfsField);
    const countExpr = buildCountExpr(config, 'r');
    const minuteExpr = buildMinuteOfDayExpr(config.timeCol, 'r');
    const dateExpr = buildDateExpr(config.dateCol, config.timeCol, 'r');
    const departMin = buildGtfsMinuteOfDayExpr('st1.departure_time');

    const hasCalendar = await tableExists(db, 'calendar');
    const hasCalendarDates = await tableExists(db, 'calendar_dates');
    // 各 (ridership 日付, GTFS service_id) のサービス稼働判定 CTE。
    // trips レイヤーの queryTripsForDate と同じロジック。
    const eligibleServiceCte = buildEligibleServiceCte(hasCalendar, hasCalendarDates, fallbackDate);
    const serviceFilterJoin = eligibleServiceCte
      ? `JOIN eligible_service es
           ON es.service_id = CAST(t.service_id AS VARCHAR)
          AND es.date_str = COALESCE(ri.date_str, '${fallbackDate}')`
      : '';

    const stopJoinOn = hasStopMap
      ? `JOIN stop_mapping smb ON CAST(r.${boardCol} AS VARCHAR) = smb.od_value`
      : '';
    const stopJoinOff = hasStopMap
      ? `JOIN stop_mapping sma ON CAST(r.${alightCol} AS VARCHAR) = sma.od_value`
      : '';
    const stopIdOn = hasStopMap ? 'smb.gtfs_value' : `CAST(r.${boardCol} AS VARCHAR)`;
    const stopIdOff = hasStopMap ? 'sma.gtfs_value' : `CAST(r.${alightCol} AS VARCHAR)`;

    await conn.query(`DROP TABLE IF EXISTS ridership_trip_assignment`);
    await conn.query(`
      CREATE TABLE ridership_trip_assignment AS
      WITH ridership_indexed AS (
        SELECT
          ROW_NUMBER() OVER () AS row_id,
          ${stopIdOn} AS b_val,
          ${stopIdOff} AS a_val,
          ${minuteExpr} AS time_min,
          ${dateExpr} AS date_str,
          ${countExpr} AS pax
        FROM ridership r ${stopJoinOn} ${stopJoinOff}
        WHERE ${stopIdOn} IS NOT NULL AND ${stopIdOff} IS NOT NULL
          AND CAST(${stopIdOn} AS VARCHAR) != '' AND CAST(${stopIdOff} AS VARCHAR) != ''
          AND ${stopIdOn} != ${stopIdOff}
      )${eligibleServiceCte ? `,${eligibleServiceCte}` : ''},
      candidate_trips AS (
        SELECT
          ri.row_id, ri.pax, ri.time_min, ri.date_str,
          CAST(t.trip_id AS VARCHAR) AS trip_id,
          CAST(t.route_id AS VARCHAR) AS route_id,
          CAST(s1.stop_id AS VARCHAR) AS b_stop_id,
          CAST(st1.stop_sequence AS INTEGER) AS b_seq,
          ${departMin} AS depart_min,
          CAST(s2.stop_id AS VARCHAR) AS a_stop_id,
          CAST(st2.stop_sequence AS INTEGER) AS a_seq
        FROM ridership_indexed ri
        JOIN stops s1 ON CAST(s1.${matchField} AS VARCHAR) = ri.b_val
        JOIN stop_times st1 ON CAST(st1.stop_id AS VARCHAR) = CAST(s1.stop_id AS VARCHAR)
        JOIN trips t ON CAST(t.trip_id AS VARCHAR) = CAST(st1.trip_id AS VARCHAR)
        ${serviceFilterJoin}
        JOIN stop_times st2 ON CAST(st2.trip_id AS VARCHAR) = CAST(t.trip_id AS VARCHAR)
        JOIN stops s2 ON CAST(s2.stop_id AS VARCHAR) = CAST(st2.stop_id AS VARCHAR)
                     AND CAST(s2.${matchField} AS VARCHAR) = ri.a_val
        WHERE CAST(st1.stop_sequence AS INTEGER) < CAST(st2.stop_sequence AS INTEGER)
      ),
      ranked AS (
        SELECT
          row_id, trip_id, route_id, b_stop_id, b_seq, depart_min,
          a_stop_id, a_seq, pax, time_min, date_str,
          ROW_NUMBER() OVER (
            PARTITION BY row_id
            ORDER BY ABS(depart_min - time_min), trip_id
          ) AS rn
        FROM candidate_trips
      )
      SELECT row_id, trip_id, route_id, b_stop_id, b_seq, depart_min,
             a_stop_id, a_seq, pax, time_min, date_str
      FROM ranked WHERE rn = 1
    `);

    // trip × date × stop_sequence ごとの onboard / 乗降数を計算
    // (date 別にバラすことで、複数日のデータがアニメ上で重ならない)
    const dpSec = buildGtfsSecondOfDayExpr('st.departure_time');
    const arSec = buildGtfsSecondOfDayExpr('COALESCE(st.arrival_time, st.departure_time)');
    const epochFromAssignDate = buildEpochFromDateExpr('a.date_str', fallbackDate);

    await conn.query(`DROP TABLE IF EXISTS ridership_by_trip_segment`);
    await conn.query(`
      CREATE TABLE ridership_by_trip_segment AS
      WITH trip_segs AS (
        -- 各 trip の隣接停留所セグメント。GTFS の HH:MM:SS を秒換算してまとめる。
        SELECT
          CAST(st.trip_id AS VARCHAR) AS trip_id,
          CAST(st.stop_id AS VARCHAR) AS from_stop_id,
          CAST(st.stop_sequence AS INTEGER) AS from_seq,
          LEAD(CAST(st.stop_id AS VARCHAR)) OVER (
            PARTITION BY st.trip_id ORDER BY CAST(st.stop_sequence AS INTEGER)
          ) AS to_stop_id,
          LEAD(CAST(st.stop_sequence AS INTEGER)) OVER (
            PARTITION BY st.trip_id ORDER BY CAST(st.stop_sequence AS INTEGER)
          ) AS to_seq,
          CAST(COALESCE(st.departure_time, st.arrival_time) AS VARCHAR) AS departure_time,
          LEAD(CAST(COALESCE(st.arrival_time, st.departure_time) AS VARCHAR)) OVER (
            PARTITION BY st.trip_id ORDER BY CAST(st.stop_sequence AS INTEGER)
          ) AS arrival_time,
          ${dpSec} AS depart_sec,
          LEAD(${arSec}) OVER (
            PARTITION BY st.trip_id ORDER BY CAST(st.stop_sequence AS INTEGER)
          ) AS arrive_sec
        FROM stop_times st
      ),
      assign_with_epoch AS (
        -- 事前に date_epoch を計算してカラム化（GROUP BY 句との依存解消のため）
        SELECT a.*, ${epochFromAssignDate} AS date_epoch
        FROM ridership_trip_assignment a
      ),
      seg_onboard AS (
        -- 各 (segment, date) に、その日の assignment 行の pax を加算
        SELECT
          ts.trip_id, a.date_str, a.date_epoch,
          ts.from_stop_id, ts.from_seq, ts.to_stop_id, ts.to_seq,
          ts.departure_time, ts.arrival_time,
          ts.depart_sec, ts.arrive_sec,
          COALESCE(SUM(CASE WHEN ts.from_seq >= a.b_seq AND ts.from_seq < a.a_seq
                            THEN a.pax ELSE 0 END), 0) AS onboard,
          COALESCE(SUM(CASE WHEN a.b_seq = ts.from_seq THEN a.pax ELSE 0 END), 0) AS boardings_at_from,
          COALESCE(SUM(CASE WHEN a.a_seq = ts.to_seq THEN a.pax ELSE 0 END), 0) AS alightings_at_to
        FROM trip_segs ts
        JOIN assign_with_epoch a ON a.trip_id = ts.trip_id
        WHERE ts.to_stop_id IS NOT NULL
        GROUP BY ts.trip_id, a.date_str, a.date_epoch,
                 ts.from_stop_id, ts.from_seq, ts.to_stop_id, ts.to_seq,
                 ts.departure_time, ts.arrival_time, ts.depart_sec, ts.arrive_sec
      )
      SELECT
        seg.trip_id,
        seg.date_str,
        (seg.date_epoch + seg.depart_sec) AS departure_unix,
        (seg.date_epoch + seg.arrive_sec) AS arrival_unix,
        CAST(t.route_id AS VARCHAR) AS route_id,
        CAST(t.service_id AS VARCHAR) AS service_id,
        CAST(COALESCE(t.direction_id, -1) AS INTEGER) AS direction_id,
        r.route_short_name, r.route_long_name,
        seg.from_stop_id, s1.stop_name AS from_stop_name,
        CAST(s1.stop_lat AS DOUBLE) AS from_stop_lat,
        CAST(s1.stop_lon AS DOUBLE) AS from_stop_lon,
        seg.from_seq,
        seg.to_stop_id, s2.stop_name AS to_stop_name,
        CAST(s2.stop_lat AS DOUBLE) AS to_stop_lat,
        CAST(s2.stop_lon AS DOUBLE) AS to_stop_lon,
        seg.to_seq,
        seg.departure_time, seg.arrival_time,
        seg.onboard, seg.boardings_at_from, seg.alightings_at_to
      FROM seg_onboard seg
      JOIN trips t ON CAST(t.trip_id AS VARCHAR) = seg.trip_id
      LEFT JOIN routes r ON CAST(r.route_id AS VARCHAR) = CAST(t.route_id AS VARCHAR)
      JOIN stops s1 ON CAST(s1.stop_id AS VARCHAR) = seg.from_stop_id
      JOIN stops s2 ON CAST(s2.stop_id AS VARCHAR) = seg.to_stop_id
      WHERE seg.onboard > 0
    `);
  } finally {
    await conn.close();
  }
}

/**
 * 停留所×便別実績フォーマット用 matching-trips。
 * 通過人数列が直接 onboard を表すため、推定不要で算出可能。
 * 出力テーブル: ridership_by_trip_segment（OD 版と同じスキーマ）
 */
async function executeMatchingTripsForTripDetail(
  db: AsyncDuckDB,
  config: RidershipFieldConfig,
  hasStopMap: boolean,
  fallbackDate: string,
): Promise<void> {
  if (!config.boardingStopCol || !config.tripIdCol || !config.timeCol) return;
  if (!config.passThroughCol && !config.countOnCol) return;
  if (!await tableExists(db, 'trips') || !await tableExists(db, 'stop_times')) return;

  const conn = await db.connect();
  try {
    const stopCol = esc(config.boardingStopCol);
    const tripCol = esc(config.tripIdCol);
    const passExpr = config.passThroughCol
      ? `COALESCE(TRY_CAST(r.${esc(config.passThroughCol)} AS INTEGER), 0)`
      : `COALESCE(TRY_CAST(r.${esc(config.countOnCol!)} AS INTEGER), 0)`;
    const onExpr = config.countOnCol
      ? `COALESCE(TRY_CAST(r.${esc(config.countOnCol)} AS INTEGER), 0)`
      : '0';
    const offExpr = config.countOffCol
      ? `COALESCE(TRY_CAST(r.${esc(config.countOffCol)} AS INTEGER), 0)`
      : '0';
    const orderExpr = `CAST(r.${esc(config.timeCol)} AS VARCHAR)`;
    const matchField = esc(config.stopGtfsField);
    const dateExpr = buildDateExpr(config.dateCol, config.timeCol, 'r');

    // データ側の便ID は同じ値（"1" 等）が複数日 / 複数路線で再利用されるため、
    // (date, route, 便ID) の複合キーで一意化する。
    const originalTripExpr = `CAST(r.${tripCol} AS VARCHAR)`;
    const routeValExpr = config.routeCol
      ? `COALESCE(CAST(r.${esc(config.routeCol)} AS VARCHAR), '')`
      : `''`;
    const compositeTripKey = `(COALESCE(${dateExpr}, '${fallbackDate}') || '|' || ${routeValExpr} || '|' || ${originalTripExpr})`;
    // 時刻列の time-of-day (秒) を抽出する SQL 式
    const timeCol = esc(config.timeCol);
    const timeStr = `CAST(r.${timeCol} AS VARCHAR)`;
    const timeOnly = `COALESCE(
      NULLIF(SPLIT_PART(${timeStr}, 'T', 2), ''),
      NULLIF(SPLIT_PART(${timeStr}, ' ', 2), ''),
      ${timeStr}
    )`;
    const secOfDayExpr = `(
      COALESCE(TRY_CAST(SPLIT_PART(${timeOnly}, ':', 1) AS INTEGER), 0) * 3600
      + COALESCE(TRY_CAST(SPLIT_PART(${timeOnly}, ':', 2) AS INTEGER), 0) * 60
      + COALESCE(TRY_CAST(SPLIT_PART(${timeOnly}, ':', 3) AS INTEGER), 0)
    )`;
    const dateEpochExpr = `COALESCE(
      EPOCH(${buildNormalizeDateExpr('per_record_date_str')}),
      EPOCH(CAST('${fallbackDate}' AS DATE))
    )`;

    const stopJoin = hasStopMap
      ? `JOIN stop_mapping sm ON CAST(r.${stopCol} AS VARCHAR) = sm.od_value`
      : '';
    const stopId = hasStopMap ? 'sm.gtfs_value' : `CAST(r.${stopCol} AS VARCHAR)`;

    // matchField=stop_name の GTFS では同名が複数 stop_id 持つことがあり、
    // 直接 JOIN すると segment が膨張する。matchField 値ごとに 1 行に正規化する。
    const stopsUniqCte = `
      stops_uniq AS (
        SELECT stop_id, stop_name, stop_lat, stop_lon
        FROM (
          SELECT
            CAST(stop_id AS VARCHAR) AS stop_id,
            CAST(stop_name AS VARCHAR) AS stop_name,
            CAST(stop_lat AS DOUBLE) AS stop_lat,
            CAST(stop_lon AS DOUBLE) AS stop_lon,
            ROW_NUMBER() OVER (
              PARTITION BY CAST(${matchField} AS VARCHAR)
              ORDER BY CAST(stop_id AS VARCHAR)
            ) AS _rn
          FROM stops
        ) WHERE _rn = 1
      )
    `;

    await conn.query(`DROP TABLE IF EXISTS ridership_by_trip_segment`);
    await conn.query(`
      CREATE TABLE ridership_by_trip_segment AS
      WITH ${stopsUniqCte},
      per_record AS (
        SELECT
          ${compositeTripKey} AS trip_id,
          ${originalTripExpr} AS original_trip_id,
          ${routeValExpr} AS data_route_id,
          ${stopId} AS stop_val,
          ${orderExpr} AS stop_order,
          ${dateExpr} AS per_record_date_str,
          ${secOfDayExpr} AS sec_of_day,
          ${passExpr} AS pass_through,
          ${onExpr} AS boarded,
          ${offExpr} AS alighted
        FROM ridership r ${stopJoin}
        WHERE ${stopId} IS NOT NULL
          AND CAST(${stopId} AS VARCHAR) != ''
          AND ${orderExpr} IS NOT NULL
          AND ${orderExpr} != ''
          AND ${originalTripExpr} != ''
      ),
      per_record_with_epoch AS (
        SELECT *,
          ${dateEpochExpr} AS date_epoch
        FROM per_record
      ),
      with_next AS (
        SELECT
          trip_id,
          original_trip_id,
          data_route_id,
          stop_val AS from_stop_val,
          LEAD(stop_val) OVER (PARTITION BY trip_id ORDER BY stop_order) AS to_stop_val,
          per_record_date_str AS date_str,
          (date_epoch + sec_of_day) AS departure_unix,
          LEAD(date_epoch + sec_of_day) OVER (PARTITION BY trip_id ORDER BY stop_order) AS arrival_unix,
          stop_order AS departure_time,
          LEAD(stop_order) OVER (PARTITION BY trip_id ORDER BY stop_order) AS arrival_time,
          pass_through,
          boarded,
          LEAD(alighted) OVER (PARTITION BY trip_id ORDER BY stop_order) AS alighted_next
        FROM per_record_with_epoch
      )
      SELECT
        wn.original_trip_id AS trip_id,
        wn.date_str,
        wn.departure_unix,
        wn.arrival_unix,
        wn.data_route_id AS route_id,
        CAST(NULL AS VARCHAR) AS service_id,
        CAST(-1 AS INTEGER) AS direction_id,
        rt.route_short_name, rt.route_long_name,
        CAST(s1.stop_id AS VARCHAR) AS from_stop_id,
        s1.stop_name AS from_stop_name,
        CAST(s1.stop_lat AS DOUBLE) AS from_stop_lat,
        CAST(s1.stop_lon AS DOUBLE) AS from_stop_lon,
        CAST(NULL AS INTEGER) AS from_seq,
        CAST(s2.stop_id AS VARCHAR) AS to_stop_id,
        s2.stop_name AS to_stop_name,
        CAST(s2.stop_lat AS DOUBLE) AS to_stop_lat,
        CAST(s2.stop_lon AS DOUBLE) AS to_stop_lon,
        CAST(NULL AS INTEGER) AS to_seq,
        wn.departure_time,
        wn.arrival_time,
        SUM(wn.pass_through) AS onboard,
        SUM(wn.boarded) AS boardings_at_from,
        SUM(COALESCE(wn.alighted_next, 0)) AS alightings_at_to
      FROM with_next wn
      LEFT JOIN routes rt ON CAST(rt.route_id AS VARCHAR) = wn.data_route_id
      LEFT JOIN stops_uniq s1 ON CAST(s1.${matchField} AS VARCHAR) = wn.from_stop_val
      LEFT JOIN stops_uniq s2 ON CAST(s2.${matchField} AS VARCHAR) = wn.to_stop_val
      WHERE wn.to_stop_val IS NOT NULL
        -- 防御策: 連続停留所間で 60 分超のギャップは別 trip の混入と見なして除外
        AND wn.arrival_unix - wn.departure_unix BETWEEN 0 AND 3600
      GROUP BY wn.original_trip_id, wn.data_route_id, wn.date_str,
               wn.departure_unix, wn.arrival_unix,
               wn.departure_time, wn.arrival_time,
               rt.route_short_name, rt.route_long_name,
               s1.stop_id, s1.stop_name, s1.stop_lat, s1.stop_lon,
               s2.stop_id, s2.stop_name, s2.stop_lat, s2.stop_lon
    `);
  } finally {
    await conn.close();
  }
}

/** matching-trips の前段テーブルを構築（フォーマットに応じて分岐）。 */
export async function buildMatchingTripsTable(
  db: AsyncDuckDB,
  config: RidershipFieldConfig,
  mode: ReconciliationMode,
  fallbackDate: string,
): Promise<void> {
  const hasStopMap = mode !== 'direct' && await tableExists(db, 'stop_mapping');
  if (config.boardingStopCol && config.alightingStopCol && config.timeCol) {
    await executeMatchingTripsForOD(db, config, hasStopMap, fallbackDate);
  } else if (config.boardingStopCol && config.tripIdCol && config.timeCol) {
    await executeMatchingTripsForTripDetail(db, config, hasStopMap, fallbackDate);
  }
}

export interface TripAssignmentStats {
  /** 実際に trip 割り当てされた ridership 行数 */
  assigned: number;
  /** 元の ridership テーブル総行数（入力件数） */
  inputRows: number;
  /** 割り当てできなかった行数 (= inputRows - assigned) */
  dropped: number;
  /** ridership 日付が GTFS feed_info の期間外 */
  outOfFeedRange: number;
  feedStartDate: string | null;
  feedEndDate: string | null;
  /** ridership に出現したユニークな日付 */
  uniqueDates: string[];
  /** feed 期間外の日付のみ抜き出したリスト */
  outOfRangeDates: string[];
}

/** matching-trips 生成後の便割り当て統計と、feed_info との整合性チェック。 */
export async function queryTripAssignmentStats(db: AsyncDuckDB): Promise<TripAssignmentStats> {
  const empty: TripAssignmentStats = {
    assigned: 0, inputRows: 0, dropped: 0, outOfFeedRange: 0,
    feedStartDate: null, feedEndDate: null, uniqueDates: [], outOfRangeDates: [],
  };
  if (!await tableExists(db, 'ridership_trip_assignment')) return empty;
  const conn = await db.connect();
  try {
    const assigned = Number(coerceRow(
      (await conn.query('SELECT COUNT(*) AS n FROM ridership_trip_assignment')).toArray()[0]!,
    ).n);
    const inputRows = await tableExists(db, 'ridership')
      ? Number(coerceRow(
          (await conn.query('SELECT COUNT(*) AS n FROM ridership')).toArray()[0]!,
        ).n)
      : assigned;

    const datesRes = await conn.query(`
      SELECT DISTINCT date_str FROM ridership_trip_assignment
      WHERE date_str IS NOT NULL ORDER BY date_str
    `);
    const uniqueDates = datesRes.toArray()
      .map(r => String(coerceRow(r).date_str))
      .filter(s => s && s !== 'null');

    // feed_info があれば期間チェック
    let feedStart: string | null = null;
    let feedEnd: string | null = null;
    let outOfFeedRange = 0;
    let outOfRangeDates: string[] = [];
    if (await tableExists(db, 'feed_info')) {
      const res = await conn.query(`
        SELECT
          MIN(CAST(feed_start_date AS VARCHAR)) AS s,
          MAX(CAST(feed_end_date AS VARCHAR)) AS e
        FROM feed_info
      `);
      const o = coerceRow(res.toArray()[0]!);
      const sRaw = o.s == null ? null : String(o.s);
      const eRaw = o.e == null ? null : String(o.e);
      feedStart = formatDateNum(sRaw);
      feedEnd = formatDateNum(eRaw);
      if (feedStart && feedEnd) {
        outOfRangeDates = uniqueDates.filter(d => d < feedStart! || d > feedEnd!);
        outOfFeedRange = outOfRangeDates.length;
      }
    }

    return {
      assigned,
      inputRows,
      dropped: Math.max(0, inputRows - assigned),
      outOfFeedRange,
      feedStartDate: feedStart,
      feedEndDate: feedEnd,
      uniqueDates,
      outOfRangeDates,
    };
  } finally {
    await conn.close();
  }
}

/** "20260501" → "2026-05-01" のような GTFS 日付数値を ISO 形式に整形 */
function formatDateNum(s: string | null): string | null {
  if (!s) return null;
  const t = s.replace(/[^\d]/g, '');
  if (t.length !== 8) return s;
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

export interface MatchingTripSegmentRow {
  trip_id: string;
  /** OD 形式のとき: 元データの日付 (YYYY-MM-DD)。停留所×便別実績では null。 */
  date_str: string | null;
  /** 区間出発の unix 秒（OD 形式のみ）。停留所×便別実績では null。 */
  departure_unix: number | null;
  /** 区間到着の unix 秒（OD 形式のみ）。停留所×便別実績では null。 */
  arrival_unix: number | null;
  route_id: string;
  service_id: string;
  direction_id: number;
  route_short_name: string | null;
  route_long_name: string | null;
  from_stop_id: string;
  from_stop_name: string;
  from_stop_lat: number;
  from_stop_lon: number;
  to_stop_id: string;
  to_stop_name: string;
  to_stop_lat: number;
  to_stop_lon: number;
  from_seq: number | null;
  to_seq: number | null;
  departure_time: string | null;
  arrival_time: string | null;
  onboard: number;
  boardings_at_from: number;
  alightings_at_to: number;
}

export async function queryMatchingTripSegments(db: AsyncDuckDB): Promise<MatchingTripSegmentRow[]> {
  if (!await tableExists(db, 'ridership_by_trip_segment')) return [];
  const conn = await db.connect();
  try {
    const res = await conn.query(`SELECT * FROM ridership_by_trip_segment`);
    return res.toArray().map(r => {
      const o = coerceRow(r);
      return {
        trip_id: String(o.trip_id),
        date_str: o.date_str == null ? null : String(o.date_str),
        departure_unix: o.departure_unix == null ? null : Number(o.departure_unix),
        arrival_unix: o.arrival_unix == null ? null : Number(o.arrival_unix),
        route_id: String(o.route_id ?? ''),
        service_id: String(o.service_id ?? ''),
        direction_id: Number(o.direction_id ?? -1),
        route_short_name: o.route_short_name == null ? null : String(o.route_short_name),
        route_long_name: o.route_long_name == null ? null : String(o.route_long_name),
        from_stop_id: String(o.from_stop_id ?? ''),
        from_stop_name: String(o.from_stop_name ?? ''),
        from_stop_lat: Number(o.from_stop_lat ?? 0),
        from_stop_lon: Number(o.from_stop_lon ?? 0),
        to_stop_id: String(o.to_stop_id ?? ''),
        to_stop_name: String(o.to_stop_name ?? ''),
        to_stop_lat: Number(o.to_stop_lat ?? 0),
        to_stop_lon: Number(o.to_stop_lon ?? 0),
        from_seq: o.from_seq == null ? null : Number(o.from_seq),
        to_seq: o.to_seq == null ? null : Number(o.to_seq),
        departure_time: o.departure_time == null ? null : String(o.departure_time),
        arrival_time: o.arrival_time == null ? null : String(o.arrival_time),
        onboard: Number(o.onboard ?? 0),
        boardings_at_from: Number(o.boardings_at_from ?? 0),
        alightings_at_to: Number(o.alightings_at_to ?? 0),
      };
    });
  } finally {
    await conn.close();
  }
}

// ───────────────────────────────────────────────────────────
// Phase 3: matching-ridership (per-record trajectory)
// ───────────────────────────────────────────────────────────

/**
 * OD 形式の個票 1 件につき、便割り当てに基づく軌跡（Kepler.gl Trip 形式）を生成。
 * 出力テーブル: ridership_trajectories
 * 適用フォーマット: OD実績(COMmmmONS), 乗降実績(一件明細)
 *
 * 前提: ridership_trip_assignment が executeMatchingTripsForOD で先に構築されている。
 */
export async function buildMatchingRidershipTable(
  db: AsyncDuckDB,
  config: RidershipFieldConfig,
  fallbackDate: string,
): Promise<void> {
  if (!await tableExists(db, 'ridership_trip_assignment')) return;
  if (!config.boardingStopCol || !config.alightingStopCol) return;

  const epochFromAssign = buildEpochFromDateExpr('a.date_str', fallbackDate);
  const secOfDayGtfs = buildGtfsSecondOfDayExpr('COALESCE(st.departure_time, st.arrival_time)');

  const conn = await db.connect();
  try {
    await conn.query(`DROP TABLE IF EXISTS ridership_trajectories`);
    await conn.query(`
      CREATE TABLE ridership_trajectories AS
      WITH stops_in_range AS (
        SELECT
          a.row_id,
          a.trip_id,
          a.route_id,
          a.b_stop_id,
          a.a_stop_id,
          a.pax,
          a.date_str,
          CAST(st.stop_id AS VARCHAR) AS stop_id,
          CAST(st.stop_sequence AS INTEGER) AS stop_seq,
          CAST(s.stop_name AS VARCHAR) AS stop_name,
          CAST(s.stop_lon AS DOUBLE) AS lon,
          CAST(s.stop_lat AS DOUBLE) AS lat,
          (${epochFromAssign} + ${secOfDayGtfs}) AS unix_time
        FROM ridership_trip_assignment a
        JOIN stop_times st ON CAST(st.trip_id AS VARCHAR) = a.trip_id
        JOIN stops s ON CAST(s.stop_id AS VARCHAR) = CAST(st.stop_id AS VARCHAR)
        WHERE CAST(st.stop_sequence AS INTEGER) BETWEEN a.b_seq AND a.a_seq
      ),
      agg AS (
        SELECT
          row_id,
          MIN(trip_id) AS trip_id,
          MIN(route_id) AS route_id,
          MIN(date_str) AS date_str,
          MIN(b_stop_id) AS boarding_stop_id,
          MIN(a_stop_id) AS alighting_stop_id,
          MIN(pax) AS passenger_count,
          LIST(lon ORDER BY stop_seq) AS lons,
          LIST(lat ORDER BY stop_seq) AS lats,
          LIST(unix_time ORDER BY stop_seq) AS unix_times,
          LIST(stop_name ORDER BY stop_seq) AS stop_names,
          MIN(unix_time) AS boarding_unix,
          MAX(unix_time) AS alighting_unix
        FROM stops_in_range
        GROUP BY row_id
      )
      SELECT
        agg.*,
        CAST(rs.stop_name AS VARCHAR) AS boarding_stop_name,
        CAST(ra.stop_name AS VARCHAR) AS alighting_stop_name,
        r.route_short_name
      FROM agg
      LEFT JOIN stops rs ON CAST(rs.stop_id AS VARCHAR) = agg.boarding_stop_id
      LEFT JOIN stops ra ON CAST(ra.stop_id AS VARCHAR) = agg.alighting_stop_id
      LEFT JOIN routes r ON CAST(r.route_id AS VARCHAR) = agg.route_id
    `);
  } finally {
    await conn.close();
  }
}

export interface MatchingRidershipRow {
  row_id: number;
  trip_id: string;
  route_id: string;
  route_short_name: string | null;
  /** OD レコードの日付 (YYYY-MM-DD)。data 行から抽出。 */
  date_str: string | null;
  boarding_stop_id: string;
  boarding_stop_name: string;
  alighting_stop_id: string;
  alighting_stop_name: string;
  passenger_count: number;
  /** 乗車時刻 (unix 秒)。日付込み。 */
  boarding_unix: number;
  /** 降車時刻 (unix 秒)。日付込み。 */
  alighting_unix: number;
  /** [lon, lat] pairs along the trajectory, ordered by stop_sequence */
  coordinates: [number, number][];
  /** unix 秒（各座標に対応）。 */
  unix_times: number[];
  stop_names: string[];
}

export async function queryMatchingRidership(db: AsyncDuckDB): Promise<MatchingRidershipRow[]> {
  if (!await tableExists(db, 'ridership_trajectories')) return [];
  const conn = await db.connect();
  try {
    const res = await conn.query(`SELECT * FROM ridership_trajectories`);
    return res.toArray().map(r => {
      const o = coerceRow(r);
      const toArr = (v: unknown): unknown[] => {
        if (v == null) return [];
        if (Array.isArray(v)) return v;
        if (typeof v === 'object' && Symbol.iterator in (v as object)) return Array.from(v as Iterable<unknown>);
        return [];
      };
      const lons = toArr(o.lons).map(Number);
      const lats = toArr(o.lats).map(Number);
      const unix_times = toArr(o.unix_times).map(Number);
      const stop_names = toArr(o.stop_names).map(String);
      const coordinates: [number, number][] = lons.map((lon, i) => [lon, lats[i] ?? 0]);
      return {
        row_id: Number(o.row_id),
        trip_id: String(o.trip_id),
        route_id: String(o.route_id ?? ''),
        route_short_name: o.route_short_name == null ? null : String(o.route_short_name),
        date_str: o.date_str == null ? null : String(o.date_str),
        boarding_stop_id: String(o.boarding_stop_id ?? ''),
        boarding_stop_name: String(o.boarding_stop_name ?? ''),
        alighting_stop_id: String(o.alighting_stop_id ?? ''),
        alighting_stop_name: String(o.alighting_stop_name ?? ''),
        passenger_count: Number(o.passenger_count ?? 1),
        boarding_unix: Number(o.boarding_unix ?? 0),
        alighting_unix: Number(o.alighting_unix ?? 0),
        coordinates,
        unix_times,
        stop_names,
      };
    });
  } finally {
    await conn.close();
  }
}
