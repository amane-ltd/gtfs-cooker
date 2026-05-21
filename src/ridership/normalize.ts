const SUFFIX_PATTERN = /(駅|停留所|バス停|前|バスターミナル)$/;

const FULLWIDTH_OFFSET = 0xFEE0;

function fullwidthToHalf(s: string): string {
  return s.replace(/[！-～]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - FULLWIDTH_OFFSET),
  );
}

function normalizeLongVowel(s: string): string {
  return s.replace(/[−–—ー]/g, 'ー');
}

export function normalizeName(name: string): string {
  let n = name;
  n = fullwidthToHalf(n);
  n = normalizeLongVowel(n);
  n = n.replace(/[\s　]+/g, '');
  n = n.replace(SUFFIX_PATTERN, '');
  n = n.toLowerCase();
  return n;
}
