// Three-way merge of synced data. Pure, so it runs under `node --test`.
//
// A snapshot is {playlists: [...], soundPresets: [...], prefs: {...}}; list
// items have an `id` and, when edited, an `updated` time. `base` is the last
// snapshot both sides agreed on, which tells additions from deletions:
//   - kept on one side, gone on the other, unchanged since base -> deleted
//   - changed on one side only -> that side wins
//   - changed on both -> merged field by field: a field changed on one side
//     only takes that change; `items` lists are merged tune by tune; a field
//     changed on both takes the side with the later `updated` (local on a tie)

export const EMPTY_SNAPSHOT = Object.freeze({ playlists: [], soundPresets: [], prefs: {} });

// Stable JSON (sorted keys) so equal data compares equal.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const same = (a, b) => canonical(a) === canonical(b);
const byId = (list = []) => new Map(list.map((x) => [x.id, x]));

export function mergeLists(baseList, localList, remoteList) {
  const base = byId(baseList), remote = byId(remoteList);
  const out = [];
  const pick = (local, remote, before) => {
    if (local && remote) {
      if (same(local, remote)) return local;
      const localChanged = !before || !same(local, before);
      const remoteChanged = !before || !same(remote, before);
      if (localChanged && !remoteChanged) return local;
      if (remoteChanged && !localChanged) return remote;
      return mergeObjects(before ?? {}, local, remote);
    }
    const only = local ?? remote;
    // Present on one side only: new there, or deleted on the other side unless edited since.
    return before && same(only, before) ? null : only;
  };
  for (const local of localList ?? []) {
    const merged = pick(local, remote.get(local.id), base.get(local.id));
    if (merged) out.push(merged);
  }
  const localIds = new Set((localList ?? []).map((x) => x.id));
  for (const r of remoteList ?? []) {
    if (localIds.has(r.id)) continue;
    const merged = pick(undefined, r, base.get(r.id));
    if (merged) out.push(merged);
  }
  return out;
}

const itemKey = (item) => `${item.path}#${item.song}`;

// Tunes in a playlist: additions from both sides, removals from both sides, local order first.
export function mergeItems(baseItems = [], localItems = [], remoteItems = []) {
  const inBase = new Set(baseItems.map(itemKey));
  const inLocal = new Set(localItems.map(itemKey));
  const inRemote = new Set(remoteItems.map(itemKey));
  const keep = (item, otherSide) => otherSide.has(itemKey(item)) || !inBase.has(itemKey(item));
  const out = localItems.filter((item) => keep(item, inRemote));
  for (const item of remoteItems) if (!inLocal.has(itemKey(item)) && !inBase.has(itemKey(item))) out.push(item);
  return out;
}

function mergeObjects(base, local, remote) {
  const remoteLater = (remote.updated ?? 0) > (local.updated ?? 0);
  const out = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    if (key === "items") out.items = mergeItems(base.items, local.items, remote.items);
    else if (same(local[key], remote[key])) out[key] = local[key];
    else if (same(local[key], base[key])) out[key] = remote[key];
    else if (same(remote[key], base[key])) out[key] = local[key];
    else out[key] = remoteLater ? remote[key] : local[key];
  }
  out.updated = Math.max(local.updated ?? 0, remote.updated ?? 0);
  return out;
}

export function mergePrefs(base = {}, local = {}, remote = {}) {
  const out = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    out[key] = !same(local[key], base[key]) ? local[key] : remote[key] ?? local[key];
  }
  return out;
}

// Two devices can each start their own Favorites before first syncing: fold
// them into one, keeping every tune once.
export function foldFavorites(playlists) {
  const favorites = playlists.filter((p) => p.favorites);
  if (favorites.length < 2) return playlists;
  const [keep, ...rest] = [...favorites].sort((a, b) => (a.created ?? 0) - (b.created ?? 0) || String(a.id).localeCompare(String(b.id)));
  const seen = new Set();
  const items = [];
  for (const p of [keep, ...rest]) {
    for (const item of p.items) {
      const key = `${item.path}#${item.song}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push(item);
      }
    }
  }
  const merged = { ...keep, items, updated: Math.max(...favorites.map((p) => p.updated ?? 0)) };
  const drop = new Set(rest.map((p) => p.id));
  return playlists.filter((p) => !drop.has(p.id)).map((p) => (p.id === keep.id ? merged : p));
}

export function mergeSnapshots(base, local, remote) {
  base ??= EMPTY_SNAPSHOT;
  return {
    playlists: foldFavorites(mergeLists(base.playlists, local.playlists, remote.playlists)),
    soundPresets: mergeLists(base.soundPresets, local.soundPresets, remote.soundPresets),
    // First sync with existing data (joining another device): its preferences win.
    prefs: base === EMPTY_SNAPSHOT && remote !== local ? { ...local.prefs, ...remote.prefs } : mergePrefs(base.prefs, local.prefs, remote.prefs),
  };
}
