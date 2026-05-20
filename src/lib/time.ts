export function parseGtfsTime(timeStr: string, baseDateStr: string): number {
  const parts = timeStr.trim().split(':');
  if (parts.length < 3) return 0;
  const hours = parseInt(parts[0]!, 10);
  const minutes = parseInt(parts[1]!, 10);
  const seconds = parseInt(parts[2]!, 10);
  const baseDate = new Date(baseDateStr + 'T00:00:00Z');
  const baseUnix = Math.floor(baseDate.getTime() / 1000);
  return baseUnix + hours * 3600 + minutes * 60 + seconds;
}

export function parseGtfsHour(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  return parseInt(parts[0] ?? '0', 10);
}
