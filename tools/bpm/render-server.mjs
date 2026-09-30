// Long-running renderer for bpm.py. Reads one request per stdin line:
//   {"path": "...", "song": 3, "seconds": 70, "sampleRate": 44100}   (song is 1-based)
// and answers with a frame: uint32le headerLength, JSON header {samples|error},
// then int16le mono PCM.
import fs from "node:fs";
import readline from "node:readline";
import loadLibsidplayfp, { SidAudioEngine } from "libsidplayfp-wasm";

const module = loadLibsidplayfp({ engine: "sidlite" });

function send(header, pcm) {
  const h = Buffer.from(JSON.stringify(header));
  const len = Buffer.alloc(4); len.writeUInt32LE(h.length);
  process.stdout.write(len); process.stdout.write(h);
  if (pcm) process.stdout.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
}

for await (const line of readline.createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const { path, song, seconds, sampleRate } = JSON.parse(line);
  const engine = new SidAudioEngine({ module, sampleRate, stereo: false, engine: "sidlite" });
  try {
    await engine.loadSidBuffer(new Uint8Array(fs.readFileSync(path)), song - 1);   // the engine counts from 0
    const pcm = await engine.renderSeconds(seconds);
    send({ samples: pcm.length }, pcm);
  } catch (e) {
    send({ error: String(e) });
  } finally { engine.dispose(); }
}
