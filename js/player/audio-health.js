// Safari can report "running" after its rendering or output clock has stopped.
export function monitorAudio(player) {
  let previous = null;
  let stalled = 0;
  let attempts = 0;
  const failed = (error) => {
    previous = null;
    stalled = attempts = 0;
    console.warn("Audio recovery failed", error);
    player.needsAudioRestart = true;
    player.pause();
    player.emit("error", { message: "Playback could not resume. Tap Play to retry.", item: player.current });
  };
  const timer = setInterval(() => {
    const { ctx, sessionAudio: audio } = player;
    if (player.u64 || player.state === "paused" || player.state === "idle") {
      previous = null;
      stalled = attempts = 0;
      return;
    }
    if (!ctx || !audio || !player.node || audio.paused || ctx.state === "interrupted" || !Number.isFinite(ctx.currentTime)) {
      previous = null;
      stalled = 0;
      return;
    }
    const sample = { ctx, clock: ctx.currentTime, output: audio.currentTime, report: player.audioReports };
    if (previous?.ctx === ctx) {
      if (sample.clock <= previous.clock || (Number.isFinite(sample.output) && sample.output <= previous.output) ||
          (previous.report !== undefined && sample.report === previous.report)) stalled++;
      else { stalled = 0; attempts = 0; }
    }
    previous = sample;
    if (stalled < 2) return;
    stalled = 0;
    if (++attempts === 1) {
      // Cycling the device preserves the current tune, buffers and position.
      ctx.suspend().then(() => {
        if (player.ctx === ctx && !player.u64 && player.state !== "paused" && !audio.paused) return ctx.resume();
      }).catch((error) => console.warn("Audio device restart failed", error));
    } else if (attempts === 2) {
      // A hung suspend/resume promise must not prevent rebuilding the engine.
      player.restartAudio().catch(failed);
    } else {
      failed(new Error("Audio clocks did not restart"));
    }
  }, 1000);
  return () => clearInterval(timer);
}
