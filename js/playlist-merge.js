import { MAX_NAME, sanitizeName } from './live-share-core.js';

export const nameKey = name => sanitizeName(name).toLowerCase();
const same = (a, b) => a.path === b.path && a.song === b.song;
export const sameItems = (a, b) => a.length === b.length && a.every((item, i) => same(item, b[i]));

// Match occurrences, rather than sets: intentional repeated tunes survive.
export function comparePlaylists(existing, incoming) {
  const rows = existing.map((item, oldIndex) => ({ existing: item, oldIndex, newIndex: -1 }));
  incoming.forEach((item, newIndex) => {
    const row = rows.find(r => r.newIndex < 0 && r.existing && same(r.existing, item));
    if (row) Object.assign(row, { incoming: item, newIndex });
  });
  incoming.forEach((item, newIndex) => {
    if (rows.some(r => r.newIndex === newIndex)) return;
    const row = rows.find(r => r.newIndex < 0 && r.existing?.path === item.path);
    if (row) Object.assign(row, { incoming: item, newIndex });
    else rows.push({ incoming: item, oldIndex: -1, newIndex });
  });
  rows.forEach(r => {
    r.kind = !r.existing ? 'added' : !r.incoming ? 'removed' : !same(r.existing, r.incoming) ? 'subtune' : 'same';
  });
  const common = rows.filter(r => r.oldIndex >= 0 && r.newIndex >= 0);
  const orderChanged = common.some((r, i) => i && common[i - 1].newIndex > r.newIndex);
  return { rows, differences: rows.filter(r => r.kind !== 'same'), orderChanged };
}

export function mergedItems(rows, choices, order = 'existing') {
  const primary = order === 'existing' ? 'oldIndex' : 'newIndex';
  const secondary = order === 'existing' ? 'newIndex' : 'oldIndex';
  // Preserve the selected side's order; append entries unique to the other side.
  return [...rows].sort((a, b) => {
    const ai = a[primary], bi = b[primary];
    return ai < 0 && bi < 0 ? a[secondary] - b[secondary] : ai < 0 ? 1 : bi < 0 ? -1 : ai - bi;
  }).flatMap(row => {
    const choice = choices.get(row);
    if (row.kind === 'same') return [row.existing];
    if (row.kind === 'added') return choice === 'add' ? [row.incoming] : [];
    if (row.kind === 'removed') return choice === 'keep' ? [row.existing] : [];
    return choice === 'both' ? [row.existing, row.incoming] : [choice === 'new' ? row.incoming : row.existing];
  }).map(item => ({ ...item }));
}

export function nextPlaylistName(name, playlists) {
  const names = new Set(playlists.map(p => nameKey(p.name)));
  const candidate = n => {
    const suffix = ` (${n})`;
    return [...sanitizeName(name)].slice(0, MAX_NAME - suffix.length).join('').trimEnd() + suffix;
  };
  let n = 1;
  while (names.has(nameKey(candidate(n)))) n++;
  return candidate(n);
}
