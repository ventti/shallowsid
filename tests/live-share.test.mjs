import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ID_PATTERN, decodeList, encodeList, isValidPath, newListId, newSeed, ownerHash, sanitizeItems, sanitizeName, tokenFor } from "../js/live-share-core.js";

test("list ids are short, unambiguous and match the rules' pattern", () => {
  for (let i = 0; i < 200; i++) assert.match(newListId(), ID_PATTERN);
  assert.doesNotMatch("abcdefghijkl", ID_PATTERN);   // contains i/l
});

test("owner proofs chain: each token hashes to the stored owner, and differs per step", async () => {
  const seed = newSeed();
  const t0 = await tokenFor(seed, 0), t1 = await tokenFor(seed, 1);
  assert.match(t0, /^[0-9a-f]{64}$/);
  assert.notEqual(t0, t1);
  assert.equal(await tokenFor(seed, 0), t0);                                   // deterministic across devices
  assert.equal(await ownerHash(t0), createHash("sha256").update(t0).digest("hex"));  // what the rules compute
  assert.notEqual(await tokenFor(newSeed(), 0), t0);
});

test("names lose markup-irrelevant tricks but keep real text", () => {
  assert.equal(sanitizeName("  Hubbard\n\tclassics  "), "Hubbard classics");
  assert.equal(sanitizeName("Hülsbeck ♥ <b>bold</b>"), "Hülsbeck ♥ <b>bold</b>");       // escaped at render, not mangled
  assert.equal(sanitizeName("abc\u202Egpj.exe"), "abc gpj.exe");                    // bidi override gone
  assert.equal(sanitizeName("a\u200Bb\u2066c\u0000d"), "a b c d");                  // zero-width, isolate, NUL
  assert.equal(sanitizeName("x".repeat(500)).length, 80);
  assert.equal(sanitizeName("😀".repeat(100)).length, 160);                         // 80 code points, not 80 units
  assert.equal(sanitizeName("\u0000\u200B  "), "Shared playlist");
  assert.equal(sanitizeName(null), "Shared playlist");
  assert.equal(sanitizeName({ toString: () => "evil" }), "Shared playlist");   // only real strings
});

test("only plausible HVSC paths get through", () => {
  for (const ok of ["MUSICIANS/H/Hubbard_Rob/Commando.sid", "GAMES/S-Z/Späßchen.sid", "DEMOS/0-9/1_2_3 (intro).sid"]) assert.ok(isValidPath(ok), ok);
  for (const bad of [
    "../../etc/passwd.sid", "MUSICIANS/../x.sid", "/MUSICIANS/H/x.sid", "https://evil.example/x.sid",
    "MUSICIANS/H/<img src=x onerror=alert(1)>.sid", 'MUSICIANS/H/a"b.sid', "MUSICIANS/H/a\u0000.sid",
    "MUSICIANS/H/x.sid.js", "DOCUMENTS/STIL.txt", "MUSICIANS\\H\\x.sid", 42, null, "M".repeat(300) + ".sid",
  ]) assert.ok(!isValidPath(bad), String(bad));
});

test("items: bad entries dropped, songs clamped, list capped, catalogue check honoured", () => {
  const items = sanitizeItems([
    { path: "MUSICIANS/H/Hubbard_Rob/Commando.sid", song: 3 },
    { path: "MUSICIANS/H/Hubbard_Rob/Delta.sid", song: 9999 },
    { path: "javascript:alert(1)", song: 1 },
    "MUSICIANS/G/Galway_Martin/Wizball.sid",
    { path: "MUSICIANS/X/Nope.sid" },
  ], (p) => !p.includes("Nope"));
  assert.deepEqual(items, [
    { path: "MUSICIANS/H/Hubbard_Rob/Commando.sid", song: 3 },
    { path: "MUSICIANS/H/Hubbard_Rob/Delta.sid", song: 1 },
    { path: "MUSICIANS/G/Galway_Martin/Wizball.sid", song: 1 },
  ]);
  assert.equal(sanitizeItems(Array(5000).fill("GAMES/A-F/x.sid")).length, 1000);
  assert.deepEqual(sanitizeItems("not a list"), []);
});

test("public document content round-trips and rejects junk", () => {
  const pl = { name: "Mix\u202E", items: [{ path: "GAMES/A-F/Commando.sid", song: 2 }, { path: "../x.sid", song: 1 }] };
  const text = encodeList(pl);
  assert.deepEqual(decodeList(text), { name: "Mix", items: [{ path: "GAMES/A-F/Commando.sid", song: 2 }] });
  assert.deepEqual(decodeList('{"deleted":true}'), { deleted: true });
  assert.equal(decodeList("not json"), null);
  assert.equal(decodeList("[1,2]"), null);
  assert.deepEqual(decodeList('{"name":{"x":1},"items":"nope"}'), { name: "Shared playlist", items: [] });
  assert.deepEqual(decodeList('{"__proto__":{"polluted":1},"name":"ok","items":[]}'), { name: "ok", items: [] });
  assert.equal({}.polluted, undefined);
});

test("pasted playlist links are recognised, and anything else refused", async () => {
  const { parsePlaylistLink } = await import("../js/live-share-core.js");
  assert.deepEqual(parsePlaylistLink("https://ventti.github.io/shallowsid/#/p/ce26znuuj7bw"), { kind: "live", id: "ce26znuuj7bw" });
  assert.deepEqual(parsePlaylistLink("  http://localhost:8765/#/p/CE26ZNUUJ7BW \n"), { kind: "live", id: "ce26znuuj7bw" });
  assert.deepEqual(parsePlaylistLink("ce26znuuj7bw"), { kind: "live", id: "ce26znuuj7bw" });
  assert.deepEqual(parsePlaylistLink("https://ventti.github.io/shallowsid/#/share/q1bKU7JS8ihNSkos_-"), { kind: "snapshot", blob: "q1bKU7JS8ihNSkos_-" });
  for (const bad of [
    "", "hello", "https://evil.example/", "https://ventti.github.io/shallowsid/#/p/../vaults/x",
    "https://x/#/p/ce26znuuj7bw/extra", "https://x/#/p/illegal-id!!", "javascript:alert(1)#/p/ce26znuuj7bw/x",
    "https://x/#/share/<script>", "https://x/#/share/abc", "https://x/#/playlist/abc", null,
  ]) assert.equal(parsePlaylistLink(bad), null, String(bad));
});
