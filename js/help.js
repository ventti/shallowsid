// Each topic has its own Settings route; add new help sections here.
export const HELP = [
  {
    id: "search",
    title: "Search",
    icon: "search-outline",
    html: `
      <h2>Titles and composers</h2>
      <p>Search by tune title, composer, release credit or folder name. Combine words to narrow the results, for example <code>hubbard commando</code>. Search ignores capitals and accents and allows small spelling mistakes.</p>
      <h2>Tags</h2>
      <p>Start with <code>#</code> to search tags. Enter <code>#</code> alone to browse all tags, or add a tag name to find matching tags and tunes.</p>
      <h2>Numbers and duration</h2>
      <ul>
        <li><code>bpm&gt;=120 &amp; bpm&lt;130</code> — tempo from 120 up to, but below, 130 BPM.</li>
        <li><code>year=1987 | year=1988</code> — either release year.</li>
        <li><code>length&gt;5:00</code> — longer than five minutes.</li>
        <li><code>subtunes&gt;1</code> — tunes with multiple subtunes.</li>
        <li><code>subtune=2</code> — the second subtune.</li>
      </ul>
      <table aria-label="Search operators">
        <thead><tr><th scope="col">Operator</th><th scope="col">Meaning</th></tr></thead>
        <tbody>
          <tr><th scope="row"><code>=</code></th><td>Equal to</td></tr>
          <tr><th scope="row"><code>!=</code></th><td>Not equal to</td></tr>
          <tr><th scope="row"><code>&gt;</code> / <code>&lt;</code></th><td>Greater than / less than</td></tr>
          <tr><th scope="row"><code>&gt;=</code> / <code>&lt;=</code></th><td>Greater than or equal to / less than or equal to</td></tr>
          <tr><th scope="row">Space / <code>&amp;</code></th><td>Both conditions must match</td></tr>
          <tr><th scope="row"><code>|</code></th><td>Either condition can match</td></tr>
        </tbody>
      </table>
      <p>Conditions joined by a space or <code>&amp;</code> are checked together before <code>|</code>. Unknown values do not match.</p>
      <p>Combine words and filters: <code>hubbard bpm&gt;140</code>. Tempo, duration, speed and feature filters return matching subtunes.</p>
      <h2>Sound features</h2>
      <p>Use <code>speed=2</code> for 2x speed, <code>ring=1</code> for ring modulation or <code>filter=1</code> for filter use. Other feature fields are <code>sync</code>, <code>digi</code>, <code>basic</code>, <code>cia</code> and <code>custom</code>. Use <code>=1</code> for present and <code>=0</code> for absent.</p>
      <p>Badge labels such as “PAL”, “6581” and “ring mod” are not yet searchable as badge values. Use the feature filters above where available.</p>`,
  },
  {
    id: "sync",
    title: "Sync",
    icon: "cloud-outline",
    html: `
      <h2>What sync keeps together</h2>
      <p>Playlist cloud sync keeps playlists, favorites, sound presets and play history the same across your devices. Open <a href="#/settings/sync">Playlist cloud sync</a> in Settings.</p>
      <h2>Connect another device</h2>
      <ol>
        <li>On your first device, choose <strong>Turn On Sync</strong>.</li>
        <li>On the other device, scan the first device’s QR code with its camera, or choose <strong>Use a Key from Another Device</strong> and enter the same key.</li>
      </ol>
      <p>Use the same key on every device you want to keep together. Existing data is merged when you join.</p>
      <h2>Keep your key safe</h2>
      <p>There are no accounts. Data is encrypted on your device before upload. Anyone with the key can access the synced data. Keep a safe copy: without the key, the server copy cannot be recovered.</p>
      <h2>Pause or retry</h2>
      <p>Turn off <strong>Sync This Device</strong> to pause only that device. Its key and local data stay in place. Turn it back on to catch up. If sync fails, check your connection and choose <strong>Sync Now</strong>.</p>
      <h2>Remove a device or change keys</h2>
      <p>Tap a device in the Devices list to remove it. Sync switches to a new key that the removed device does not receive. Other devices switch when they next sync; devices that missed an earlier key update may need the current key entered by hand.</p>
      <p><strong>Generate New Key</strong> starts a new synced copy. Other devices must join with the new key. The old server copy remains; delete it first if you no longer need it.</p>
      <h2>Delete the server copy</h2>
      <p><strong>Delete Synced Data</strong> deletes the encrypted server copy, turns sync off and forgets the key on this device. Data stored on your devices stays.</p>`,
  },
];

export const ABOUT = {
  id: "about",
  title: "About",
  html: `
  <header class="ion-text-center">
    <img class="notice-logo" src="icons/icon-192.png" width="88" height="88" alt="">
    <h1 class="notice-title">ShallowSID</h1>
    <p class="muted">The easy C64 music web player<br>Version <code data-version>dev</code></p>
  </header>

  <h2>Music</h2>
  <p>All tunes come from the <a href="https://www.hvsc.c64.org/" target="_blank" rel="noopener">High Voltage SID Collection</a> and its team, including the song lengths in <code>Songlengths.md5</code>.</p>

  <h2>Player engine</h2>
  <p><a href="https://github.com/libsidplayfp/libsidplayfp" target="_blank" rel="noopener">libsidplayfp</a> and reSIDfp, built for WebAssembly by
    <a href="https://github.com/chrisgleissner/libsidplayfp-wasm" target="_blank" rel="noopener">libsidplayfp-wasm</a>.
    Licensed under the GNU General Public License, version 2 or later.
    <a href="https://cdn.jsdelivr.net/npm/libsidplayfp-wasm@1.1.0/dist/complete-source.tar.gz" target="_blank" rel="noopener">Corresponding source</a> of the build ShallowSID uses.</p>

  <h2>Libraries</h2>
  <ul>
    <li><a href="https://ionicframework.com/" target="_blank" rel="noopener">Ionic</a> for the interface.</li>
    <li><a href="https://github.com/lucaong/minisearch" target="_blank" rel="noopener">MiniSearch</a> for search.</li>
    <li><a href="https://www.dicebear.com/" target="_blank" rel="noopener">DiceBear</a> Critters (composer pages), CC0.</li>
    <li><a href="https://github.com/kazuhikoarase/qrcode-generator" target="_blank" rel="noopener">qrcode-generator</a> and <a href="https://github.com/cozmo/jsQR" target="_blank" rel="noopener">jsQR</a> for sync key QR codes.</li>
  </ul>

  <h2>Acknowledgements</h2>
  <p>Special thanks to Sulevi, Tempest and Grue for their help and contribution to the development.</p>

  <h2>License</h2>
  <p>ShallowSID is free software under the <a href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html" target="_blank" rel="noopener">GNU GPL, version 2 or later</a>.
    Source code: <a href="https://github.com/ventti/shallowsid" target="_blank" rel="noopener">github.com/ventti/shallowsid</a>.</p>`,
};
