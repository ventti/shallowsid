import { test } from "node:test";
import assert from "node:assert/strict";
import { toM3U8, parseM3U8, normalizeEntry, encodeShare, decodeShare, safeFileName } from "../js/playlist-format.js";

const playlist = {
  name: "Hubbard classics",
  items: [
    { path: "MUSICIANS/H/Hubbard_Rob/Commando.sid", song: 1 },
    { path: "MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid", song: 3 },
    { path: "GAMES/S-Z/Späßchen.sid", song: 1 },
  ],
};

test("m3u8 round-trips name, paths and subtunes", () => {
  const text = toM3U8(playlist, {
    baseUrl: "https://example.org/shallowsid/hvsc/",
    meta: (path) => (path.includes("Commando") ? { title: "Commando", author: "Rob Hubbard", seconds: 236 } : null),
  });
  assert.match(text, /^#EXTM3U\n#PLAYLIST:Hubbard classics\n#EXTINF:236,Rob Hubbard - Commando\n/);
  assert.match(text, /https:\/\/example\.org\/shallowsid\/hvsc\/GAMES\/S-Z\/Sp%C3%A4%C3%9Fchen\.sid/);
  assert.deepEqual(parseM3U8(text), playlist);
});

test("import accepts the usual path styles", () => {
  const cases = {
    "https://www.example.com/hvsc/MUSICIANS/G/Galway_Martin/Wizball.sid": "MUSICIANS/G/Galway_Martin/Wizball.sid",
    "hvsc/DEMOS/A-F/Blah.sid": "DEMOS/A-F/Blah.sid",
    "/MUSICIANS/T/Tel_Jeroen/Cybernoid.sid": "MUSICIANS/T/Tel_Jeroen/Cybernoid.sid",
    "C:\\HVSC\\C64Music\\GAMES\\A-F\\Commando.sid": "GAMES/A-F/Commando.sid",
    "MUSICIANS/D/Daglish_Ben/Last_Ninja.sid": "MUSICIANS/D/Daglish_Ben/Last_Ninja.sid",
  };
  for (const [input, path] of Object.entries(cases)) assert.equal(normalizeEntry(input).path, path, input);
  assert.deepEqual(normalizeEntry("/MUSICIANS/X/x.sid?subtune=4"), { path: "MUSICIANS/X/x.sid", song: 4 });
  assert.deepEqual(normalizeEntry("/MUSICIANS/X/x.sid#2"), { path: "MUSICIANS/X/x.sid", song: 2 });
  assert.equal(normalizeEntry("song.mp3").path, null);
});

test("plain m3u without extensions imports with subtune 1", () => {
  const parsed = parseM3U8("/MUSICIANS/A/a.sid\r\n\r\n# comment\n/MUSICIANS/B/b.sid#3\n", "mine");
  assert.deepEqual(parsed, { name: "mine", items: [{ path: "MUSICIANS/A/a.sid", song: 1 }, { path: "MUSICIANS/B/b.sid", song: 3 }] });
});

test("share links round-trip and stay URL-safe", async () => {
  const blob = await encodeShare(playlist);
  assert.match(blob, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeShare(blob), playlist);
});

test("file names are filesystem-safe", () => {
  assert.equal(safeFileName("Hubbard: best/of!"), "Hubbard_bestof.m3u8");
  assert.equal(safeFileName("///"), "playlist.m3u8");
});
