import type { MappingRow, MatchStatus, CandidateGroup } from './types';
import { normalizeName } from './normalize';

interface OdEntry {
  code: string;
  name: string;
}

export function autoMatch(
  odEntries: OdEntry[],
  groups: CandidateGroup[],
): MappingRow[] {
  const groupById = new Map<string, CandidateGroup>();
  const groupByName = new Map<string, CandidateGroup>();
  const groupByNorm = new Map<string, CandidateGroup>();
  const groupByEntryId = new Map<string, CandidateGroup>();

  for (const g of groups) {
    if (!groupById.has(g.groupId)) groupById.set(g.groupId, g);
    if (!groupByName.has(g.groupName)) groupByName.set(g.groupName, g);
    const norm = normalizeName(g.groupName);
    if (norm && !groupByNorm.has(norm)) groupByNorm.set(norm, g);
    for (const e of g.entries) {
      if (!groupByEntryId.has(e.id)) groupByEntryId.set(e.id, g);
    }
  }

  return odEntries.map(od => {
    const mkRow = (g: CandidateGroup, status: MatchStatus): MappingRow => ({
      odCode: od.code,
      odName: od.name,
      gtfsIds: g.entries,
      status,
    });

    const byGroupId = groupById.get(od.code);
    if (byGroupId) return mkRow(byGroupId, 'exact-id');

    const byEntryId = groupByEntryId.get(od.code);
    if (byEntryId) return mkRow(byEntryId, 'exact-id');

    const byName = groupByName.get(od.name);
    if (byName) return mkRow(byName, 'exact-name');

    const norm = normalizeName(od.name);
    if (norm) {
      const byNorm = groupByNorm.get(norm);
      if (byNorm) return mkRow(byNorm, 'normalized');
    }

    if (od.name && norm) {
      const partials = groups.filter(g => {
        const gn = normalizeName(g.groupName);
        return gn.includes(norm) || norm.includes(gn);
      }).slice(0, 5);

      if (partials.length > 0) {
        return {
          odCode: od.code,
          odName: od.name,
          gtfsIds: partials[0]!.entries,
          status: 'partial',
        };
      }
    }

    return { odCode: od.code, odName: od.name, gtfsIds: [], status: 'unmatched' };
  });
}
