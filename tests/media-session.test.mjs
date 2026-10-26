import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.self = globalThis;
globalThis.PixelAvatar = (await import("../js/pixelavatar.js")).default;
const { connectMediaSession } = await import("../js/player/media-session.js");

test("system controls reach the player and artwork publishes atomically for the latest track", async (t) => {
  const originals = new Map(["navigator", "MediaMetadata", "Image", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const handlers = {};
  const oldMetadata = { title: "Old", artwork: [{ src: "old.png" }] };
  const ms = { metadata: oldMetadata, setActionHandler(action, handler) { handlers[action] = handler; } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaSession: ms } });
  globalThis.MediaMetadata = class { constructor(info) { Object.assign(this, info); } };
  const images = [];
  globalThis.Image = class { constructor() { images.push(this); } };
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/png;base64,cover" }) };
  const calls = [];
  const player = new EventTarget();
  for (const action of ["play", "pause", "next", "previous", "seek"]) player[action] = (...args) => calls.push([action, ...args]);
  player.position = 30;
  connectMediaSession(player);
  handlers.play();
  handlers.pause();
  handlers.nexttrack();
  handlers.previoustrack();
  handlers.seekforward({});
  handlers.seekbackward({ seekOffset: 5 });
  handlers.seekto({ seekTime: 70 });
  assert.deepEqual(calls, [["play"], ["pause"], ["next"], ["previous"], ["seek", 40], ["seek", 25], ["seek", 70]]);
  const track = (title) => player.dispatchEvent(new CustomEvent("track", { detail: { item: { title, path: title, author: "Composer", song: 1 } } }));
  track("First");
  track("Second");
  assert.equal(ms.metadata, oldMetadata);
  images[1].onload();
  await Promise.resolve();
  assert.equal(ms.metadata.title, "Second");
  assert.equal(ms.metadata.artwork.length, 1);
  images[0].onload();
  await Promise.resolve();
  assert.equal(ms.metadata.title, "Second");
  track("Broken cover");
  images[2].onerror(new Error("image failed"));
  await Promise.resolve();
  assert.equal(ms.metadata.title, "Broken cover");
});
