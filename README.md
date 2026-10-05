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
- **Numbers**: compare `bpm`, `length`, `year`, `subtunes`, `subtune` or `speed` with `=` `!=` `>` `<` `>=` `<=`, joined with `&` (or a space) and `|`; `&` goes first. Mix them with words: `hubbard bpm>=120 & bpm<130`, `year=1987 | year=1988`, `length>5:00`, `speed>=2`. The SID features are 0 or 1: `filter`, `ring`, `sync`, `digi`, `basic`, `cia` (a CIA timer) and `custom` (custom timing), as in `filter=1 & ring=1`. All but year and subtunes compare per subtune, so those results list subtunes. A value that's unknown never matches.
- **Now Playing** shows what [`tools/sidfeatures`](tools/sidfeatures/features.py) found for the subtune beside the SID model and clock: its speed when it isn't 1x (**2x speed**), **CIA** for a CIA timer, **Custom timing** when there's no steady play rate (delay loops, a timer it keeps changing), and **Filter**, **Ring mod**, **Sync**, **Digi** or **BASIC**.
- **Tune links**: the share icon beside the star in Now Playing, or **Share…** in a tune's **⋯** menu, shares (or, without a share sheet, copies) a link such as `…/#/tune/3/MUSICIANS/H/Hubbard_Rob/Commando.sid` (subtune 3). It opens the tune ready to play; browsers only start audio after a tap, so it waits for **Play**.
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

- **Engine** picks what plays the tunes. It's kept per device and isn't synced.
  - **reSIDfp** (the default) is cycle-exact, and the presets below tune its filter.
  - **SIDLite** comes in the same libsidplayfp build and needs about a tenth of the CPU. Chip and machine apply, but the presets' filter knobs don't.
  - Until you pick one, a slow device switches itself to SIDLite: when the first pre-render runs under 2× realtime (timed once per device), or when playback stalls twice within a minute.
  - **Ultimate** plays on an [Ultimate 64 or Ultimate II+](https://ultimate64.com/) on your network. Type its IP address (or `host:port`). See [Ultimate 64](#ultimate-64) for its limits.

- **Chip** (Auto/6581/8580) and **Machine** (Auto/PAL/NTSC) are set once, apart from the presets. Auto follows each tune.
- One **6581 preset** and one **8580 preset** are selected at a time. The one for the chip that plays is used.
  - 6581 presets hold the filter curve and range, old capacitors and combined waveforms. 8580 presets hold the filter curve, digi boost and combined waveforms.
  - **MOS 6581R4AR 0687 14** and **CSG 8580R5 1690 25** are the defaults. They are the two chips reSIDfp's filter model was measured on, and the only presets with real measurements behind them.
  - The built-in presets everyone gets, and the defaults, are in `js/sid-presets.json`.
  - Changes play from where the tune is. Adjusting a built-in preset creates an edited copy. **Save as 6581/8580 Preset…** keeps it. Your own presets save automatically.
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

Tags:

- Tunes can carry tags such as **Ballad**, **Title Tune** or **Digi Samples**, from a fixed list in [`js/tags-vocab.json`](js/tags-vocab.json). They show under the composer in Now Playing. Tap one for every tune with it. Home shows the most used tags, and typing `#` in search lists them.
- A tag is on a whole tune or on one subtune. A subtune also shows the whole tune's tags.
- Only curators can tag. They get a **Tag** chip in Now Playing, **Edit Tags…** in the **⋯** menu and the **T** key. The sheet toggles tags for **Whole Tune** or **Subtune N**. **Done**, or swiping it away, saves.
- Tunes can show a tempo first in Now Playing. **~124 BPM** is an estimate from the sound (see [BPM estimates](#bpm-estimates-experimental)); **124 BPM** was set by a curator.
- Curators set it in the same sheet, as a whole BPM from 20 to 300, for the whole tune or one subtune. A subtune's own wins, then the whole tune's, then the estimate. Empty the field to fall back to the one underneath, shown greyed out. **0** means no BPM, which also hides a wrong estimate.
- Curators join with a one-time invite link from an admin, valid for two weeks. Accepting turns on Sync if it's off, since the rights live in your synced data. They then get a **Curation** tab right of **Playlists**, with their edits. Use the same sync key on your other devices to curate there too.
- Admins get an **Admin** tab there instead. It also invites curators, shows their edits and has an on/off switch per curator. An invite nobody has used yet can be expired early with **Expire**. A curator that's off can't tag; their tags stay. Who tagged what is shown only to that curator and to admins.
- Others see new tags after the next deploy, which runs daily. Curators see them at once.

Install as an app:

- **Install app** in the footer appears where the browser can install (Chrome and Edge on desktop and Android; on iOS it explains **Share → Add to Home Screen**).
- Once visited, the app's own files and libraries are cached, so it opens without a connection. Tunes still stream from HVSC.

Gestures on phones:

- Mini-player: **tap** or **swipe up** opens Now Playing. **Swipe down** plays or pauses. **Swipe left/right** skips.
- Now Playing cover: **tap** plays or pauses. **Swipe left/right** skips. **Swipe down** closes.
- Now Playing **shuffle** plays the rest of the queue in random order; off returns to the original order. **Repeat** cycles: off → whole queue → this tune. Both are remembered in this browser.

Keyboard: **Space** plays or pauses. **Shift+←/→** skips. **F** toggles Favorite.

Playlists:

- Adding a tune (same subtune) that a playlist already has asks first. **Always Allow in This Playlist**, or **Allow Duplicates** in the playlist's **⋮** menu, stops asking for that playlist. Favorites keep each tune once.
- **Save playlist file…** writes `ShallowSID - <name>.m3u8` with absolute Firebase mirror URLs. The subtune goes in an `#EXTSID:subtune=N` line.
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

   The first run downloads HVSC (~85 MB), reads every tune's header into `data/index.json`, then deletes the download. Only that ~5 MB catalogue is kept, in `~/.cache/shallowsid/_site`. The songs are fetched from the Firebase mirror when played, with the official HVSC site as a fallback.

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

Sync talks to Firestore's REST API directly, with no secrets in the repo. The only Firebase SDK in use is App Check, loaded from gstatic on the first Firestore request. To enable it:

1. Create a Firebase project and a Firestore database in an EU location (production mode).
2. Publish the rules: the deploy workflow does it (see below). Or run `tools/build_rules.py` and paste the `firestore.rules` it writes into **Firestore → Rules** once.
3. Optional, and it needs billing enabled: add a TTL policy on the field `expireAt` for collection group `vaults2`. Records then expire 12 months after the last sync. Without it, records stay until deleted, and `privacy.html` says so.
4. Register a **Web app** and copy its `apiKey`, `projectId` and `appId` into [`js/sync-config.js`](js/sync-config.js). All are public.
5. In Google Cloud **Credentials**, restrict that API key:
   - **HTTP referrers:** `https://sid.extend.fi/*` and `http://localhost:8765/*`
   - **API restrictions:** Cloud Firestore API and Firebase App Check API
6. Fill in the placeholders in [`privacy.html`](privacy.html).

With `js/sync-config.js` left empty, sync is hidden.

### App Check (bot protection)

App Check makes Firestore answer only this site. It uses invisible, score-based reCAPTCHA Enterprise, which is free up to 10,000 assessments a month. Tokens are cached, so that's plenty.

1. Create a score-based **reCAPTCHA** web key in Google Cloud **Security → reCAPTCHA** for the domains `sid.extend.fi` and `localhost`.
2. In **Firebase → App Check → Apps**, register the web app with the **reCAPTCHA Enterprise** provider and the site key.
3. Put the site key in `recaptchaSiteKey` in [`js/sync-config.js`](js/sync-config.js) and deploy.
4. On localhost the browser console prints an App Check debug token. Add it under **App Check → Apps → Manage debug tokens**.
5. Watch **App Check → APIs → Cloud Firestore** for a few days. Once nearly all requests show as verified, click **Enforce**.

With `recaptchaSiteKey` empty, or with an emulator `endpoint`, requests go out without App Check.

### Vaults and write proofs

Synced records live at `vaults2/<id>`. Knowing an id lets you read the ciphertext, but only a device with the sync key can change or delete the record (see the comments in [`firestore.rules.in`](firestore.rules.in)).

Records from before this are in `vaults/`, which is read-only. A device reads its old record once and writes a new one to `vaults2`. The old records can't be deleted from the app, so remove the `vaults` collection in the Firestore console once devices have moved over.

### Tags and curators

Curators have no accounts either. Each has a random seed that syncs with their data; `curators/<id>` holds a proof chain like the vaults, and every tag edit is one batch that also moves the curator's chain on. Invites live at `invites/<sha256(secret)>` and work once. See the comments in `firestore.rules.in`.

The tag ids live only in `js/tags-vocab.json`. `firestore.rules.in` is a template: `tools/build_rules.py` writes `firestore.rules` (not in git) from it with those ids filled in, so the rules and the app always ship the same list. CI builds it before testing and deploying, and keeps it as the run's **firestore-rules** artifact; `tools/deploy_rules.py` and the unit tests build it themselves.

- Add, rename the label of, or regroup a tag in `js/tags-vocab.json` (keep each group in alphabetical order), commit and push. Nothing else to run.
- To take a tag out, move its id to `"retired"`. The app hides it, but the rules still accept it, so devices on the previous version can still save those tunes. Deleting an id outright makes the deploy refuse.

`tools/curators.py` uses your gcloud login (`gcloud auth login`), which isn't bound by the rules. It reads the project from `js/sync-config.js`.

1. Make yourself an admin. Open the printed link in ShallowSID, on a device with Sync on:

   ```sh
   tools/curators.py invite --role admin
   ```

2. Invite curators from **Admin → Invite a Curator…** in the app (or `tools/curators.py invite`).
3. `tools/curators.py list` lists everyone. `tools/curators.py off <id>` and `on <id>` turn anyone off and back on, admins too; in the app, admins can only switch curators.

## Deploying the Firebase rules

`.github/workflows/deploy-firebase.yaml` builds and deploys `firestore.rules`. The Pages workflow runs it after the build and deploys the site only if it succeeded. On pull requests it only runs the checks.

Before releasing, it:

- checks the rules are built from the current tag list,
- runs the unit tests, then the rules in the Firestore emulator: tags, curators and invites (`tests/rules/rules-check.mjs`), and sync and live links (`tests/rules/sync-check.mjs`),
- refuses rules that would stop accepting a tag id the live rules accept,
- has Firebase compile the rules, and skips the release if they're unchanged.

The release is one atomic switch, and the site waits a minute for it to take effect. Rules never change data. The service account can deploy rules and read the database, but not write to it. Firebase keeps earlier rulesets under **Firestore → Rules**, so rolling back is picking one there.

Setup (once), with Workload Identity Federation, so no key is stored in GitHub:

```sh
PROJECT=shallowsid
NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
SA=shallowsid-ci@$PROJECT.iam.gserviceaccount.com

gcloud services enable firebaserules.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project $PROJECT
gcloud iam service-accounts create shallowsid-ci --project $PROJECT --display-name "ShallowSID GitHub Actions"
gcloud projects add-iam-policy-binding $PROJECT --member serviceAccount:$SA --role roles/firebaserules.admin
gcloud projects add-iam-policy-binding $PROJECT --member serviceAccount:$SA --role roles/datastore.viewer

gcloud iam workload-identity-pools create github --project $PROJECT --location global --display-name GitHub
gcloud iam workload-identity-pools providers create-oidc shallowsid --project $PROJECT --location global \
  --workload-identity-pool github --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref \
  --attribute-condition "assertion.repository == 'ventti/shallowsid' && assertion.ref == 'refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding $SA --project $PROJECT --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/ventti/shallowsid"

gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --body "projects/$NUMBER/locations/global/workloadIdentityPools/github/providers/shallowsid"
gh variable set GCP_SERVICE_ACCOUNT --body "$SA"
```

- Only runs on `main` of this repo can get a token, so a branch or a fork can't deploy rules.
- The same account exports the tags into `data/tags-index.json` on each deploy.
- Until the variables are set, the site doesn't deploy. Set the repo variable `FIREBASE_RULES_DEPLOY` to `off` to deploy the site without the rules.
- To try it without releasing: **Actions → Deploy Firebase rules → Run workflow** (a dry run by default), or locally `tools/deploy_rules.py --dry-run` with your gcloud login.

Run the emulator checks locally (needs Java 11+). The emulator reads `firestore.rules`, so build it first:

```sh
tools/build_rules.py && npx firebase-tools@15.31.0 emulators:exec --only firestore --project demo-shallowsid \
  "node tests/rules/rules-check.mjs && node tests/rules/sync-check.mjs"
```

## Deployment

`.github/workflows/pages.yml` builds the catalogue and deploys it with the app to GitHub Pages on every push to `main`, and daily to pick up new tags. The site is about 5 MB. Enable Pages with source **GitHub Actions** in the repo settings.

## Local HVSC copy (optional)

If the Firebase mirror and hvsc.c64.org are unreachable, the app falls back to an `hvsc/` folder next to `index.html`. To get the latest HVSC there (~375 MB unpacked):

```sh
tools/fetch_hvsc.py --dest ~/.cache/shallowsid/_site/hvsc
```

When `<out>/hvsc` exists, `tools/build_index.py` builds the catalogue from it instead of downloading. For GitHub Pages, run `tools/fetch_hvsc.py --dest _site/hvsc` before the build step. It fits under the 1 GB limit.

## HVSC Firebase Hosting

SID hosting is separate from the GitHub Pages app, at
`https://shallowsid-hvsc.web.app/<HVSC path>`. Collection files are generated
locally or in CI and never committed. `firebase.json` selects only the
`shallowsid-hvsc` hosting site; deploy with `--only hosting` to avoid changing
Firestore rules.

The pinned Firebase CLI uploads each original SID individually as level-9 gzip.
Hosting negotiates gzip with browsers and transparently decodes downloads for
`fetch()`, preserving normal `.sid` URLs. Do not gzip the local files a second
time. CORS allows public browser reads, including from `https://sid.extend.fi`.
SIDs cache for one day; `manifest.json` revalidates so release checks stay fresh.

Build, deploy and verify locally:

```sh
python3 tools/fetch_hvsc.py --dest _hvsc-source --keep-archive
python3 tools/prepare_hvsc_hosting.py
firebase deploy --only hosting --project shallowsid --non-interactive
python3 tools/check_hvsc_hosting.py
```

Preparation reports the collection version, file count, original/gzip byte totals
and elapsed time. It preserves the archive's `DOCUMENTS` directory. Verification
checks the live manifest plus original bytes, gzip and CORS for a tune from each
of MUSICIANS, GAMES and DEMOS.

**Actions → Deploy HVSC to Firebase Hosting → Run workflow** updates the full
collection on demand. It also checks January 1 and July 1, after the usual
December and June releases, and runs on `main` when its
scripts/configuration change. Unchanged collections and hosting configuration
skip deployment; a lower HVSC version cannot replace a newer deployed release.
Each release atomically replaces the complete file tree, including path renames
and removals. Firebase reuses uploads by content hash. The Pages workflow keeps
this scheduled workflow enabled during periods without repository activity.

CI reuses `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT` with no
service-account key. Its existing rules/tag permissions do not grant Hosting
deployment. The narrower additional custom role is defined in
`tools/hvsc-hosting-role.yaml`; it can update existing Hosting sites across the
`shallowsid` project, but cannot create/delete sites or change IAM:

```sh
gcloud iam roles create hvscHostingDeployer --project shallowsid \
  --file tools/hvsc-hosting-role.yaml
gcloud projects add-iam-policy-binding shallowsid \
  --member serviceAccount:shallowsid-ci@shallowsid.iam.gserviceaccount.com \
  --role projects/shallowsid/roles/hvscHostingDeployer --condition=None
```

Use Firebase Console → Hosting → `shallowsid-hvsc` → release storage settings
to keep a small number of releases (for example, two). Old releases consume the
shared Hosting storage allowance. Keep the project on Spark for free hosting
with traffic cut off at its quota rather than paid overages. Hosting does not
change the SID files' copyrights or grant redistribution rights.

## BPM estimates (experimental)

`tools/bpm/` estimates the tempo of every subtune, a folder at a time, and ships the results with the site. It renders a minute of each with SIDLite (~65x realtime) and runs two of essentia's tempo estimators on it, one worker per core. All of HVSC takes about 6 hours on a 16-core Mac. Written for my own use, so beware of peculiarities.

Set up once, in `tools/bpm`:

```sh
npm install
uv venv -p 3.12 .venv && VIRTUAL_ENV=.venv uv pip install -r requirements.txt
```

### Usage

Every now and then:

1. Analyse a folder (subfolders included; paths not found are tried under `hvsc/`):
   ```sh
   tools/bpm/bpm.py MUSICIANS/H/Hubbard_Rob
   ```
   It shows done/total with the time elapsed and left; `-v` adds a line per subtune (time, tune, status, BPM). Results add up in `tools/bpm/results.jsonl` (not committed), so nothing is done twice. **Ctrl-C** stops it; the same command continues.
2. Make a list of what needs an ear:
   ```sh
   tools/bpm/review.py todo
   ```
   It writes `tools/bpm/review.txt` and `review.m3u8`, a playlist to import in the app. Subtunes curators have set are left out, read from the site's `tags-index.json`.
3. Listen, and in `review.txt` replace each `?` with the BPM you hear, or `-` for no clear tempo. Leave `?` to skip one.
4. Publish and commit:
   ```sh
   tools/bpm/review.py publish
   git add tools/bpm/estimates.tsv && git commit -m "chore(bpm): estimates for Rob Hubbard"
   ```
   The next deploy builds `estimates.tsv` into `data/index.json`, and the app shows the estimates.

To do steps 1 and 4 for all of HVSC in one go, run `tools/bpm/run_hvsc.sh`. It continues where it stopped, publishes even when stopped with **Ctrl-C**, and with `--commit` also commits `estimates.tsv` (never pushes). Other options go to `bpm.py`, e.g. `--workers 12 -v`.

### Notes

- Each subtune's status in `results.jsonl`:
  - `ok`: both estimators agree, confidently. Published as is.
  - `double`: one is double the other. The usual mistake; the right one is usually one of the two.
  - `check`: anything else, often 3:2 or 4:3.
  - `short`: under 30 s by `Songlengths.md5`, so not rendered. Needs `data/index.json`.
  - `silent`: nothing to measure.
- `estimates.tsv` is one sorted `path, song, bpm, source` line per subtune. `auto` lines follow the latest results; `checked` ones (your answers) are never overwritten.
- Curators always win in the app: their BPM, or their 0, hides the estimate.
- `todo` won't overwrite answers you haven't published yet.
- `bpm.py --force` redoes subtunes; `--list` takes a file of `path[:song]` lines.
- `review.py compare human.txt` scores the estimates against `path:song bpm` lines, and `review.py compare curators` against what curators have set.

### Ultimate 64

The page sends each tune to the device's REST API (`POST /v1/runners:sidplay`). The firmware sends no CORS headers, so the page can't read the device's replies, use the `PUT` routes, or send a password. So:

- Turn off the device's **Network Password**.
- **Status** under the address shows whether the device answers (checked every 5 s while **Sound** is open). That's all the page can learn: what it plays stays unknown.
- The play button turns into play/stop. Stopping plays a silent tune, and only when the device was playing for ShallowSID.
- Tunes always play from the start. Seeking restarts the tune.
- There's no waveform, and the app can't tell whether the device actually played anything. It only knows the request went out.
- From `https://sid.extend.fi`, only Chrome reaches a local-network address. It asks for permission to access your local network first. Safari and Firefox block it as mixed content, so for those, run ShallowSID over `http://` yourself (`tools/dev.sh`).

## How it works

- `tools/build_index.py` parses every PSID/RSID header, joins in `Songlengths.md5`, the BPM estimates and the SID features (`tools/sidfeatures/features.tsv`), and writes a columnar `data/index.json` (~4.9 MB, ~1.3 MB gzipped).
- SID files are fetched one at a time from `https://shallowsid-hvsc.web.app/<path>` with gzip and CORS. The official `https://www.hvsc.c64.org/download/C64Music/<path>` and an optional local `hvsc/` copy are fallbacks. The plain HVSC archive mirrors don't allow cross-origin fetches.
- `js/search-worker.js` indexes that with [MiniSearch](https://lucaong.github.io/minisearch/) off the main thread.
- `js/player/engine-worker.js` renders with reSIDfp (or SIDLite) and runs as two workers:
  - A **live** engine renders about 0.25 s ahead of the playhead. It's what you hear, and sound changes apply to it at once.
  - A **cache** engine pre-renders the whole tune, about 13× realtime on an M1 and slower on phones.
- `js/player/sid-worklet.js` plays live audio when it has it, and cached audio otherwise (right after a seek or chip change, while the live engine catches up). Emulation is deterministic, so both sources sound the same and switching between them is seamless.
- Songs end at their HVSC song length (3:00 if unknown).
- `js/player/u64.js` hands tunes to an Ultimate instead, and a clock stands in for the playhead.

## Known issues

- Rendering on older phones may only be a few times faster than realtime, so the first seconds after a far forward seek can buffer.
- Tunes longer than ~10 minutes keep a sliding window of audio. Seeking far back re-renders from that point.
- No C64 ROMs are shipped. libsidplayfp's built-in fallbacks play most RSID tunes, but some BASIC-driven tunes may be silent.
- On iOS, the audio unlocks only after the first tap. Before Safari 17, the mute switch silences Web Audio.
- Playback uses the CI-maintained Firebase mirror, with the official HVSC download URL and a local copy as fallbacks. If neither remote source is available, use a local HVSC copy (see above).
- Needs a browser with WebAssembly exception handling (Safari 18+, recent Chrome/Firefox).
- Playlists are stored in `localStorage`, so they stay in that browser. Export or share them to move them around.

## Acknowledgements

- [HVSC](https://www.hvsc.c64.org/) and its team, for the collection and `Songlengths.md5`.
- [libsidplayfp](https://github.com/libsidplayfp/libsidplayfp) and reSIDfp, and [libsidplayfp-wasm](https://github.com/chrisgleissner/libsidplayfp-wasm) for the WebAssembly build ([corresponding source](https://cdn.jsdelivr.net/npm/libsidplayfp-wasm@1.0.1/dist/complete-source.tar.gz)).
- [DeepSID](https://github.com/Chordian/deepsid) by Chordian, for showing how it's done.
- [Ionic](https://ionicframework.com/), [MiniSearch](https://github.com/lucaong/minisearch), [DiceBear](https://www.dicebear.com/), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), [jsQR](https://github.com/cozmo/jsQR), [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P).

## License

GPL-2.0-or-later, because the player engine is. See [LICENSE](LICENSE).
