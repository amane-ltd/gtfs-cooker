import type { AsyncDuckDB } from '@duckdb/duckdb-wasm';
import { tableExists } from './loader';
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

        if (config.countOnCol && config.countOffCol) {
          const onExpr = `SUM(COALESCE(TRY_CAST(r.${esc(config.countOnCol)} AS INTEGER), 0))`;
          const offExpr = `SUM(COALESCE(TRY_CAST(r.${esc(config.countOffCol)} AS INTEGER), 0))`;
          await conn.query(`
            CREATE TABLE ridership_by_stop AS
            WITH boarding AS (
              SELECT ${stopIdOn} AS gtfs_stop_val, ${onExpr} AS count_on
              FROM ridership r ${stopJoinOn}
              WHERE ${stopIdOn} IS NOT NULL
              GROUP BY ${stopIdOn}
            ),
            alighting AS (
              SELECT ${stopIdOff} AS gtfs_stop_val, ${offExpr} AS count_off
              FROM ridership r ${stopJoinOff}
              WHERE ${stopIdOff} IS NOT NULL
              GROUP BY ${stopIdOff}
            )
            SELECT COALESCE(b.gtfs_stop_val, a.gtfs_stop_val) AS gtfs_stop_val,
                   COALESCE(b.count_on, 0) AS count_on,
                   COALESCE(a.count_off, 0) AS count_off
            FROM boarding b FULL OUTER JOIN alighting a ON b.gtfs_stop_val = a.gtfs_stop_val
          `);
        } else {
          await conn.query(`
            CREATE TABLE ridership_by_stop AS
            WITH boarding AS (
              SELECT ${stopIdOn} AS gtfs_stop_val,
                     SUM(${countExpr}) AS count_on
              FROM ridership r ${stopJoinOn}
              WHERE ${stopIdOn} IS NOT NULL
              GROUP BY ${stopIdOn}
            ),
            alighting AS (
              SELECT ${stopIdOff} AS gtfs_stop_val,
                     SUM(${countExpr}) AS count_off
              FROM ridership r ${stopJoinOff}
              WHERE ${stopIdOff} IS NOT NULL
              GROUP BY ${stopIdOff}
            )
            SELECT COALESCE(b.gtfs_stop_val, a.gtfs_stop_val) AS gtfs_stop_val,
                   COALESCE(b.count_on, 0) AS count_on,
                   COALESCE(a.count_off, 0) AS count_off
            FROM boarding b FULL OUTER JOIN alighting a ON b.gtfs_stop_val = a.gtfs_stop_val
          `);
        }
      } else {
        if (config.countOnCol && config.countOffCol) {
          await conn.query(`
            CREATE TABLE ridership_by_stop AS
            SELECT ${stopIdOn} AS gtfs_stop_val,
                   SUM(COALESCE(TRY_CAST(r.${esc(config.countOnCol)} AS INTEGER), 0)) AS count_on,
                   SUM(COALESCE(TRY_CAST(r.${esc(config.countOffCol)} AS INTEGER), 0)) AS count_off
            FROM ridership r ${stopJoinOn}
            WHERE ${stopIdOn} IS NOT NULL
            GROUP BY ${stopIdOn}
          `);
        } else {
          await conn.query(`
            CREATE TABLE ridership_by_stop AS
            SELECT ${stopIdOn} AS gtfs_stop_val,
                   SUM(${countExpr}) AS count_on,
                   0 AS count_off
            FROM ridership r ${stopJoinOn}
            WHERE ${stopIdOn} IS NOT NULL
            GROUP BY ${stopIdOn}
          `);
        }
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

      await conn.query(`
        CREATE TABLE ridership_by_route AS
        SELECT ${routeId} AS gtfs_route_val,
               SUM(${countExpr}) AS ridership_count
        FROM ridership r ${routeJoin}
        WHERE ${routeId} IS NOT NULL
        GROUP BY ${routeId}
      `);
    }

    // ── ridership_by_segment ───────────────────────
    await conn.query(`DROP TABLE IF EXISTS ridership_by_segment`);

    if (config.boardingStopCol && config.alightingStopCol) {
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

      await conn.query(`
        CREATE TABLE ridership_by_segment AS
        SELECT ${stopIdOn} AS from_stop_val, ${stopIdOff} AS to_stop_val,
               SUM(${countExpr}) AS riders
        FROM ridership r ${stopJoinOn} ${stopJoinOff}
        WHERE ${stopIdOn} IS NOT NULL AND ${stopIdOff} IS NOT NULL
        GROUP BY ${stopIdOn}, ${stopIdOff}
      `);
    } else if (config.boardingStopCol && config.tripIdCol && config.stopSequenceCol) {
      const stopCol = esc(config.boardingStopCol);
      const tripCol = esc(config.tripIdCol);
      const seqCol = esc(config.stopSequenceCol);
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

      await conn.query(`
        CREATE TABLE ridership_by_segment AS
        WITH ordered AS (
          SELECT
            ${stopId} AS gtfs_stop_val,
            ${partitionKey} AS trip_key,
            CAST(r.${seqCol} AS INTEGER) AS stop_seq,
            ${passThroughExpr} AS pass_through
          FROM ridership r ${stopJoin}
          WHERE ${stopId} IS NOT NULL
        ),
        with_next AS (
          SELECT
            gtfs_stop_val AS from_stop_val,
            LEAD(gtfs_stop_val) OVER (PARTITION BY trip_key ORDER BY stop_seq) AS to_stop_val,
            pass_through
          FROM ordered
        )
        SELECT from_stop_val, to_stop_val, SUM(pass_through) AS riders
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
          SUM(${countExpr}) AS ridership
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
}

export async function queryRidershipFlows(db: AsyncDuckDB): Promise<RidershipArcRow[]> {
  const conn = await db.connect();
  try {
    const res = await conn.query(`SELECT * FROM ridership_by_flow`);
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
        value: Number(o.ridership ?? 0),
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
