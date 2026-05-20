import type { FeatureCollection } from 'geojson';
import type { ExportFormat } from '../store/app-store';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function featuresToRows(fc: FeatureCollection): Record<string, unknown>[] {
  return fc.features.map(f => {
    const props = { ...f.properties } as Record<string, unknown>;
    if (f.geometry.type === 'Point') {
      const [lon, lat] = f.geometry.coordinates;
      props._longitude = lon;
      props._latitude = lat;
    }
    for (const [k, v] of Object.entries(props)) {
      if (Array.isArray(v)) {
        props[k] = v.join(', ');
      }
    }
    return props;
  });
}

function buildCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const keys = Object.keys(rows[0]!);
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [keys.map(escape).join(',')];
  for (const row of rows) {
    lines.push(keys.map(k => escape(row[k])).join(','));
  }
  return lines.join('\n');
}

export function downloadGeoJSON(data: FeatureCollection, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  triggerDownload(new Blob([json], { type: 'application/geo+json' }), filename);
}

export function downloadCsv(data: FeatureCollection, filename: string): void {
  const bom = '﻿';
  const csv = bom + buildCsv(featuresToRows(data));
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}

export async function downloadXlsx(data: FeatureCollection, filename: string): Promise<void> {
  const { utils, writeFile } = await import('xlsx');
  const rows = featuresToRows(data);
  const ws = utils.json_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'Sheet1');
  writeFile(wb, filename);
}

function extForFormat(format: ExportFormat): string {
  switch (format) {
    case 'csv': return '.csv';
    case 'xlsx': return '.xlsx';
    default: return '.geojson';
  }
}

export async function downloadLayer(
  data: FeatureCollection,
  name: string,
  format: ExportFormat,
): Promise<void> {
  const filename = `${name}${extForFormat(format)}`;
  switch (format) {
    case 'csv':
      downloadCsv(data, filename);
      break;
    case 'xlsx':
      await downloadXlsx(data, filename);
      break;
    default:
      downloadGeoJSON(data, filename);
  }
}

export async function downloadAll(
  layers: Record<string, FeatureCollection>,
  format: ExportFormat,
): Promise<void> {
  const entries = Object.entries(layers);
  if (entries.length === 1) {
    const [name, data] = entries[0]!;
    await downloadLayer(data, name, format);
    return;
  }

  if (format === 'geojson') {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const [name, data] of entries) {
      zip.file(`${name}.geojson`, JSON.stringify(data, null, 2));
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, 'gtfs-cooker-output.zip');
    return;
  }

  if (format === 'xlsx') {
    const { utils, writeFile } = await import('xlsx');
    const wb = utils.book_new();
    for (const [name, data] of entries) {
      const rows = featuresToRows(data);
      const ws = utils.json_to_sheet(rows);
      utils.book_append_sheet(wb, ws, name);
    }
    writeFile(wb, 'gtfs-cooker-output.xlsx');
    return;
  }

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const [name, data] of entries) {
    const bom = '﻿';
    zip.file(`${name}.csv`, bom + buildCsv(featuresToRows(data)));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, 'gtfs-cooker-output.zip');
}
