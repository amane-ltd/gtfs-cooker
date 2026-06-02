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
    }

    // ── ridership_by_route ─────────────────────────
    await conn.query(`DROP TABLE IF EXISTS ridership_by_route`);

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
