import { detectAndDecode } from '../gtfs/encoding';

export interface ParseResult {
  headers: string[];
  csvText: string;
}

export interface ExcelParseResult {
  sheets: string[];
  file: File;
}

function isExcel(file: File): boolean {
  const ext = file.name.toLowerCase();
  return ext.endsWith('.xlsx') || ext.endsWith('.xls');
}

export async function readRidershipFile(file: File): Promise<ParseResult | ExcelParseResult> {
  if (isExcel(file)) {
    const xlsx = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const wb = xlsx.read(buffer, { type: 'array' });
    return { sheets: wb.SheetNames, file };
  }

  const buffer = await file.arrayBuffer();
  const csvText = detectAndDecode(buffer);
  const firstLine = csvText.split('\n')[0] ?? '';
  const headers = firstLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return { headers, csvText };
}

export async function readExcelSheet(file: File, sheetName: string): Promise<ParseResult> {
  const xlsx = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const wb = xlsx.read(buffer, { type: 'array' });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);

  const csvText = xlsx.utils.sheet_to_csv(ws);
  const firstLine = csvText.split('\n')[0] ?? '';
  const headers = firstLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return { headers, csvText };
}

export function isExcelResult(r: ParseResult | ExcelParseResult): r is ExcelParseResult {
  return 'sheets' in r;
}
