import type { ValidationResult } from './types';
import {
  GTFS_REQUIRED_FILES,
  GTFS_CONDITIONALLY_REQUIRED_FILES,
  GTFS_OPTIONAL_FILES,
  GTFS_JP_FILES,
} from './types';

const ALL_KNOWN_FILES = new Set<string>([
  ...GTFS_REQUIRED_FILES,
  ...GTFS_CONDITIONALLY_REQUIRED_FILES,
  ...GTFS_OPTIONAL_FILES,
  ...GTFS_JP_FILES,
]);

interface ColumnSpec {
  required: string[];
  conditionallyRequired?: string[];
}

const REQUIRED_COLUMNS: Record<string, ColumnSpec> = {
  'agency.txt': {
    required: ['agency_name', 'agency_url', 'agency_timezone'],
    conditionallyRequired: ['agency_id'],
  },
  'routes.txt': {
    required: ['route_id', 'route_type'],
    conditionallyRequired: ['route_short_name', 'route_long_name', 'agency_id'],
  },
  'stops.txt': {
    required: ['stop_id'],
    conditionallyRequired: ['stop_name', 'stop_lat', 'stop_lon'],
  },
  'trips.txt': {
    required: ['route_id', 'service_id', 'trip_id'],
  },
  'stop_times.txt': {
    required: ['trip_id', 'stop_sequence'],
    conditionallyRequired: ['arrival_time', 'departure_time', 'stop_id'],
  },
  'calendar.txt': {
    required: [
      'service_id', 'monday', 'tuesday', 'wednesday', 'thursday',
      'friday', 'saturday', 'sunday', 'start_date', 'end_date',
    ],
  },
  'calendar_dates.txt': {
    required: ['service_id', 'date', 'exception_type'],
  },
  'shapes.txt': {
    required: ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'],
  },
  'feed_info.txt': {
    required: ['feed_publisher_name', 'feed_publisher_url', 'feed_lang'],
  },
  'fare_attributes.txt': {
    required: ['fare_id', 'price', 'currency_type', 'payment_method', 'transfers'],
    conditionallyRequired: ['agency_id'],
  },
  'fare_rules.txt': {
    required: ['fare_id'],
  },
  'frequencies.txt': {
    required: ['trip_id', 'start_time', 'end_time', 'headway_secs'],
  },
  'transfers.txt': {
    required: ['transfer_type'],
    conditionallyRequired: ['from_stop_id', 'to_stop_id'],
  },
  'translations.txt': {
    required: ['table_name', 'field_name', 'language', 'translation'],
  },
  'attributions.txt': {
    required: ['organization_name'],
  },
  'levels.txt': {
    required: ['level_id', 'level_index'],
  },
  'pathways.txt': {
    required: ['pathway_id', 'from_stop_id', 'to_stop_id', 'pathway_mode', 'is_bidirectional'],
  },
};

function parseHeaderColumns(headerLine: string): string[] {
  return headerLine
    .replace(/^﻿/, '')
    .split(',')
    .map(c => c.trim().replace(/\r$/, '').replace(/^"/, '').replace(/"$/, ''));
}

export function validateFiles(fileNames: string[]): ValidationResult[] {
  const results: ValidationResult[] = [];
  const nameSet = new Set(fileNames.map(f => f.toLowerCase()));

  for (const req of GTFS_REQUIRED_FILES) {
    if (!nameSet.has(req)) {
      results.push({ level: 'error', message: `必須ファイル ${req} が見つかりません`, file: req });
    }
  }

  if (!nameSet.has('stops.txt')) {
    results.push({
      level: 'warning',
      message: 'stops.txt がありません（locations.geojson を使用しない場合は必須）',
      file: 'stops.txt',
    });
  }

  if (!nameSet.has('calendar.txt') && !nameSet.has('calendar_dates.txt')) {
    results.push({
      level: 'error',
      message: 'calendar.txt または calendar_dates.txt のいずれかが必要です',
    });
  }

  if (nameSet.has('translations.txt') && !nameSet.has('feed_info.txt')) {
    results.push({
      level: 'error',
      message: 'translations.txt がある場合、feed_info.txt は必須です',
      file: 'feed_info.txt',
    });
  }

  if (!nameSet.has('feed_info.txt')) {
    results.push({
      level: 'warning',
      message: 'feed_info.txt がありません（推奨、GTFS-JP では必須）',
      file: 'feed_info.txt',
    });
  }

  if (!nameSet.has('shapes.txt')) {
    results.push({
      level: 'warning',
      message: 'shapes.txt がありません。lines レイヤーは stop_times ベースの近似になります',
      file: 'shapes.txt',
    });
  }

  if (
    (nameSet.has('networks.txt') || nameSet.has('route_networks.txt'))
    && fileNames.some(f => f.toLowerCase() === 'routes.txt')
  ) {
    results.push({
      level: 'info',
      message: 'networks.txt / route_networks.txt を検出（routes.txt の network_id と排他）',
    });
  }

  const isGtfsJp = nameSet.has('agency_jp.txt') || nameSet.has('routes_jp.txt') || nameSet.has('office_jp.txt');
  if (isGtfsJp) {
    results.push({ level: 'info', message: 'GTFS-JP 拡張ファイルを検出しました' });
  }

  for (const name of fileNames) {
    if (!ALL_KNOWN_FILES.has(name.toLowerCase())) {
      results.push({ level: 'info', message: `未知のファイル: ${name}（スキップ）`, file: name });
    }
  }

  return results;
}

export function validateColumns(fileName: string, headerLine: string): ValidationResult[] {
  const results: ValidationResult[] = [];
  const columns = parseHeaderColumns(headerLine);
  const spec = REQUIRED_COLUMNS[fileName.toLowerCase()];
  if (!spec) return results;

  for (const col of spec.required) {
    if (!columns.includes(col)) {
      results.push({
        level: 'error',
        message: `${fileName} に必須カラム "${col}" がありません`,
        file: fileName,
      });
    }
  }

  if (spec.conditionallyRequired) {
    for (const col of spec.conditionallyRequired) {
      if (!columns.includes(col)) {
        results.push({
          level: 'warning',
          message: `${fileName} に条件付き必須カラム "${col}" がありません`,
          file: fileName,
        });
      }
    }
  }

  if (fileName.toLowerCase() === 'routes.txt') {
    const hasShortName = columns.includes('route_short_name');
    const hasLongName = columns.includes('route_long_name');
    if (!hasShortName && !hasLongName) {
      results.push({
        level: 'error',
        message: `${fileName}: route_short_name または route_long_name のいずれかが必要です`,
        file: fileName,
      });
    }
  }

  return results;
}
