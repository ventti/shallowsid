// Chrome removes a suspended AudioContext from its media session. A normal
// audio element stays available for resume when paused. Its silent loop gives
// the SID worklet that same lifetime. iOS uses the actual SID stream instead.
export function createSessionAudio(player, stream) {
  if (stream) {
    const audio = new Audio();
    audio.srcObject = stream;
    return connectControls(audio, player);
  }
  const sampleRate = 8000;
  const samples = sampleRate * 8;
  const wav = new Uint8Array(44 + samples);
  const view = new DataView(wav.buffer);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) wav[offset + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, wav.length - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, samples, true);
  wav.fill(128, 44); // unsigned 8-bit silence
  const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  const audio = new Audio(url);
  audio.loop = true;
  // Keep the URL valid for resumes; it is released with the document.
  return connectControls(audio, player);
}

function connectControls(audio, player) {
  // Do not mute it: muted elements do not hold media-session audio focus.
  // Some browser controls operate on the element directly, bypassing the
  // Media Session action handler. Keep both entry points connected.
  audio.addEventListener("play", () => {
    if (!audio.paused && !player.u64 && !player.scrubbing && player.state === "paused") player.play();
  });
  audio.addEventListener("pause", () => {
    if (audio.paused && !player.u64 && player.state !== "paused" && player.state !== "idle") player.pause();
  });
  return audio;
}
