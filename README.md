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
- **Browse**: walk the HVSC folders (`MUSICIANS`, `GAMES`, `DEMOS`).
- **Tap** a tune to play it. The list becomes the play queue.
- **★** next to the title in Now Playing (or **F** on the keyboard) adds the tune to **Favorites**. Tap again to remove it. Favorited tunes show a small star in lists.
- **⋯** on a tune: add to or remove from Favorites, play next, add to queue, add to playlist, go to folder.
- **Waveform**: drag to scrub (you hear it), release to seek. Grey bars are rendered audio; the flat line is still being rendered.
- **Subtune**: pick one from the Now Playing view.

Gestures on phones:

- Mini-player: **tap** or **swipe up** opens Now Playing. **Swipe down** plays or pauses. **Swipe left/right** skips.
- Now Playing cover: **tap** plays or pauses. **Swipe left/right** skips. **Swipe down** closes.

Keyboard: **Space** plays or pauses. **Shift+←/→** skips. **F** toggles Favorite.

Playlists:

- **Export** writes an `.m3u8` with absolute hvsc.c64.org URLs. The subtune goes in an `#EXTSID:subtune=N` line.
- **Import** accepts `.m3u`/`.m3u8` with URLs, `hvsc/…` paths or plain HVSC paths such as `/MUSICIANS/H/Hubbard_Rob/Commando.sid`.
- **Share** makes a link with the whole playlist compressed into the URL. No server involved.

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
- `js/player/engine-worker.js` renders the tune with reSIDfp, about 13× realtime on an M1 and slower on phones. It streams PCM to `js/player/sid-worklet.js`, an AudioWorklet that keeps the rendered audio for instant seeks and scrub grains.
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
- [Ionic](https://ionicframework.com/), [MiniSearch](https://github.com/lucaong/minisearch), [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P).

## License

GPL-2.0-or-later, because the player engine is. See [LICENSE](LICENSE).
