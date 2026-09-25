# ShallowSID

A small, phone-first player for the High Voltage SID Collection. Inspired by [DeepSID](https://github.com/Chordian/deepsid), but much shallower.

## Introduction

ShallowSID searches all ~61,000 tunes of [HVSC](https://www.hvsc.c64.org/) and plays them in the browser with [libsidplayfp](https://github.com/libsidplayfp/libsidplayfp)'s cycle-exact reSIDfp engine, compiled to WebAssembly ([libsidplayfp-wasm](https://github.com/chrisgleissner/libsidplayfp-wasm)).

- Static site: plain HTML and ES modules, with [Ionic](https://ionicframework.com/) from a CDN. No build step for the app itself.
- Playlists live in your browser. Export them as `.m3u8`, or share them as a link.
- Each tune is rendered ahead of playback, so seeking is instant and scrubbing is audible.

Written for my own use, so beware of peculiarities.

## Usage

- **Search**: type a title, composer, group or year. Exact title matches come first, then the composer's tunes, then titles starting with the query, then looser matches. Each group is sorted A–Z. Accents are optional: `hulsbeck` finds Hülsbeck.
- **Composer pages**: tap a composer chip, or the composer's name in Now Playing. Shows an animated [DiceBear](https://www.dicebear.com/) critter (the same one every time), the tune count and years, **Your top tunes**, all their tunes, and those credited jointly **With others**. Playing from a section queues just that section.
- **Your favorite composers** and **Jump back in** (on the search page) come from what you've played on this device. Jump back in shows **Your most played** (your top 50 tunes), **Favorites**, **Recently played** and the playlists you last played. A tune counts once heard for 30 seconds, or half of a shorter one. **Save as Playlist** keeps a copy of most or recently played.
- **Sort** (the ⇅ button beside the search field): Relevance, Name, Folder, Release (publisher or group) or Year. Tap the current order again to reverse it. The last order used becomes the default. Folders and composer pages have the same button above their tunes, with **Default** (HVSC's order) in place of Relevance; they remember their own order.
- **Browse**: walk the HVSC folders (`MUSICIANS`, `GAMES`, `DEMOS`).
- **Tap** a tune to play it. The list becomes the play queue.
- **★** next to the title in Now Playing (or **F** on the keyboard) adds the tune to **Favorites**. Tap again to remove it. Favorited tunes show a small star in lists.
- **⋯** on a tune: add to or remove from Favorites, play next, add to queue, add to playlist, go to folder.
- **Waveform**: drag to scrub (you hear it), release to seek. Grey bars are rendered audio; the flat line is still being rendered.
- **Subtune**: pick one from the Now Playing view.

Sound (the **Sound** button in Now Playing):

- **Auto-select** plays each tune on the chip it was written for. This is the default.
- **MOS 6581R4AR 0687 14** and **CSG 8580R5 1690 25** force one chip for every tune. They are the two chips reSIDfp's filter model was measured on, and the only chip presets with real measurements behind them.
- **Adjust**: chip (Auto/6581/8580), machine (Auto/PAL/NTSC; Auto follows each tune), 6581 filter curve and range, 8580 filter curve, old 6581 capacitors, combined waveforms and 8580 digi boost. Changes play from where the tune is.
  - Adjusting a measured chip creates an edited copy. **Save as new preset…** keeps it. Your own presets save automatically.
  - Presets export and import as `ShallowSID - Sound - <name>.json`.
  - CheeseCutter/VICE-style chip profiles (6581R3 4885, …) use the older reSID-fp filter model, so they don't carry over.
- While the sheet is open, sliders are heard as you drag them. Scrubbing is off and pre-rendering pauses; when you close the sheet, the tune pre-renders again with the new sound.
- **Pre-render tunes** (on by default) renders the whole tune ahead for instant seeking and audible scrubbing. With it off, seeking waits for the engine to fast-forward, and nothing is kept in memory.

Sync (the cloud icon on **Playlists**, optional and off by default):

- **Turn On Sync** creates a sync key such as `XA3W-GK29-…`. On another device, point the camera at the QR code shown under the key, or tap **Scan QR Code from Another Device**, or **Use a Key from Another Device…** and type it. Playlists, favorites, sound presets and play history (**Recently played**, **Your most played**) then stay the same everywhere. Play counts add up across devices.
- There are no accounts. Everything is encrypted in the browser with the key, and the server only stores ciphertext under an ID derived from it. Lose the key and the synced copy is gone, but your local data stays.
- **Sync This Device** pauses and resumes sync. The key is kept, so turning it back on catches up.
- **Generate New Key…** starts a new synced copy. Devices on the old key stop syncing with this one until they switch too.
- **Devices** lists everything using the key: OS, browser, when it last synced, and a place guessed from the time zone (no location permission). Tap an old device to remove it: sync moves to a new key, your other devices switch over on their next sync, and the removed one can't follow. Devices not yet updated to this version have to enter the new key by hand. The list is encrypted with the rest.
- **Delete Synced Data…** removes the server copy and forgets the key. Nothing expires on its own. See [privacy.html](privacy.html).

Install as an app:

- **Install app** in the footer appears where the browser can install (Chrome and Edge on desktop and Android; on iOS it explains **Share → Add to Home Screen**).
- Once visited, the app's own files and libraries are cached, so it opens without a connection. Tunes still stream from HVSC.

Gestures on phones:

- Mini-player: **tap** or **swipe up** opens Now Playing. **Swipe down** plays or pauses. **Swipe left/right** skips.
- Now Playing cover: **tap** plays or pauses. **Swipe left/right** skips. **Swipe down** closes.

Keyboard: **Space** plays or pauses. **Shift+←/→** skips. **F** toggles Favorite.

Playlists:

- **Save playlist file…** writes `ShallowSID - <name>.m3u8` with absolute hvsc.c64.org URLs. The subtune goes in an `#EXTSID:subtune=N` line.
  - On phones it opens the share sheet, so **Save to Files** puts it in iCloud Drive, or in Google Drive/Dropbox if their apps are installed.
  - In desktop Chrome/Edge a **Save as** dialog opens, so you can pick a synced cloud folder. Other browsers just download it.
- **Import** (on **Playlists**): **Import File…** opens the system file picker, where the same cloud drives show up. **Open Link…** takes a pasted live or snapshot link and shows the playlist to save. It accepts `.m3u`/`.m3u8` with URLs, `hvsc/…` paths or plain HVSC paths such as `/MUSICIANS/H/Hubbard_Rob/Commando.sid`.
- **Share** offers two kinds of link:
  - **Live Link:** a short `…/#/p/<id>` link that always shows your latest version. Anyone with it can view; only your devices can change it. The playlist is stored unencrypted for that, until you choose **Stop Sharing**.
  - **Snapshot Link:** the whole playlist compressed into the URL. No server involved.

## Local development

Needs Python 3, `7z` or `bsdtar`, and Node 20+ for the tests.

1. Build the index and serve the app:

   ```sh
   tools/dev.sh 8000
   ```

   The first run downloads HVSC (~85 MB), reads every tune's header into `data/index.json`, then deletes the download. Only that ~5 MB catalogue is kept, in `~/.cache/shallowsid/_site`. The songs are streamed from hvsc.c64.org when played.

2. Open <http://localhost:8000>.

For a faster build, index only part of HVSC:

```sh
tools/dev.sh 8000 --subset MUSICIANS/H
```

Run the tests:

```sh
node --test "tests/*.test.mjs"
```

In the devtools console, `shallowsid.player` and `shallowsid.store` are exposed for poking around.

## Sync backend (Firebase)

Sync talks to Firestore's REST API directly, with no SDK and no secrets in the repo. To enable it:

1. Create a Firebase project and a Firestore database in an EU location (production mode).
2. Paste [`firestore.rules`](firestore.rules) into **Firestore → Rules** and publish.
3. Optional, and it needs billing enabled: add a TTL policy on the field `expireAt` for collection group `vaults`. Records then expire 12 months after the last sync. Without it, records stay until deleted, and `privacy.html` says so.
4. Register a **Web app** and copy its `apiKey` and `projectId` into [`js/sync-config.js`](js/sync-config.js). Both are public.
5. In Google Cloud **Credentials**, restrict that API key:
   - **HTTP referrers:** `https://ventti.github.io/*` and `http://localhost:8765/*`
   - **API restrictions:** Cloud Firestore API only
6. Fill in the placeholders in [`privacy.html`](privacy.html).

With `js/sync-config.js` left empty, sync is hidden.

## Deployment

`.github/workflows/pages.yml` builds the catalogue and deploys it with the app to GitHub Pages on every push to `main`. The site is about 5 MB. Enable Pages with source **GitHub Actions** in the repo settings.

## Local HVSC copy (optional)

If hvsc.c64.org is unreachable, the app falls back to an `hvsc/` folder next to `index.html`. To get the latest HVSC there (~375 MB unpacked):

```sh
tools/fetch_hvsc.py --dest ~/.cache/shallowsid/_site/hvsc
```

When `<out>/hvsc` exists, `tools/build_index.py` builds the catalogue from it instead of downloading. For GitHub Pages, run `tools/fetch_hvsc.py --dest _site/hvsc` before the build step. It fits under the 1 GB limit.

## How it works

- `tools/build_index.py` parses every PSID/RSID header, joins in `Songlengths.md5`, and writes a columnar `data/index.json` (~4.9 MB, ~1.3 MB gzipped).
- SID files are fetched one at a time from `https://www.hvsc.c64.org/download/C64Music/<path>`, which allows cross-origin requests. The plain HVSC mirrors don't, so a browser can't fetch from them.
- `js/search-worker.js` indexes that with [MiniSearch](https://lucaong.github.io/minisearch/) off the main thread.
- `js/player/engine-worker.js` renders with reSIDfp and runs as two workers:
  - A **live** engine renders about 0.25 s ahead of the playhead. It's what you hear, and sound changes apply to it at once.
  - A **cache** engine pre-renders the whole tune, about 13× realtime on an M1 and slower on phones.
- `js/player/sid-worklet.js` plays live audio when it has it, and cached audio otherwise (right after a seek or chip change, while the live engine catches up). Emulation is deterministic, so both sources sound the same and switching between them is seamless.
- Songs end at their HVSC song length (3:00 if unknown).

## Known issues

- Rendering on older phones may only be a few times faster than realtime, so the first seconds after a far forward seek can buffer.
- Tunes longer than ~10 minutes keep a sliding window of audio. Seeking far back re-renders from that point.
- No C64 ROMs are shipped. libsidplayfp's built-in fallbacks play most RSID tunes, but some BASIC-driven tunes may be silent.
- On iOS, the audio unlocks only after the first tap. Before Safari 17, the mute switch silences Web Audio.
- Playback depends on hvsc.c64.org's download URL. It works and allows cross-origin fetches, but it isn't a documented API. If it changes, use a local HVSC copy (see above).
- Needs a browser with WebAssembly exception handling (Safari 18+, recent Chrome/Firefox).
- Playlists are stored in `localStorage`, so they stay in that browser. Export or share them to move them around.

## Acknowledgements

- [HVSC](https://www.hvsc.c64.org/) and its team, for the collection and `Songlengths.md5`.
- [libsidplayfp](https://github.com/libsidplayfp/libsidplayfp) and reSIDfp, and [libsidplayfp-wasm](https://github.com/chrisgleissner/libsidplayfp-wasm) for the WebAssembly build ([corresponding source](https://cdn.jsdelivr.net/npm/libsidplayfp-wasm@1.0.1/dist/complete-source.tar.gz)).
- [DeepSID](https://github.com/Chordian/deepsid) by Chordian, for showing how it's done.
- [Ionic](https://ionicframework.com/), [MiniSearch](https://github.com/lucaong/minisearch), [DiceBear](https://www.dicebear.com/), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), [jsQR](https://github.com/cozmo/jsQR), [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P).

## License

GPL-2.0-or-later, because the player engine is. See [LICENSE](LICENSE).
