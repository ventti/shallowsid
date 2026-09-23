// Minimal swipe/tap recogniser on pointer events.
//
// swipeable(el, { onTap, onLeft, onRight, onUp, onDown, follow })
//   follow: true moves `el` horizontally with the finger and snaps it back.
// Returns a function that detaches the listeners.

const SWIPE_DISTANCE = 60;      // px
const SWIPE_VELOCITY = 0.5;     // px/ms, a quick flick counts even if short
const TAP_SLOP = 8;             // px of movement still counted as a tap

export function swipeable(el, handlers) {
  let start = null;

  const down = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest("button, ion-button, a, [data-no-swipe]")) return;
    start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    el.setPointerCapture?.(e.pointerId);
  };

  const move = (e) => {
    if (!start || e.pointerId !== start.id || !handlers.follow) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      el.style.transition = "none";
      el.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
      el.style.opacity = String(1 - Math.min(Math.abs(dx) / 400, 0.5));
    }
  };

  const up = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    const dt = Math.max(performance.now() - start.t, 1);
    start = null;
    if (handlers.follow) {
      el.style.transition = "transform 200ms ease, opacity 200ms ease";
      el.style.transform = "";
      el.style.opacity = "";
    }
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const isSwipe = (d) => d > SWIPE_DISTANCE || (d > TAP_SLOP * 2 && d / dt > SWIPE_VELOCITY);
    if (ax < TAP_SLOP && ay < TAP_SLOP) handlers.onTap?.(e);
    else if (ax > ay && isSwipe(ax)) (dx < 0 ? handlers.onLeft : handlers.onRight)?.(e);
    else if (ay > ax && isSwipe(ay)) (dy < 0 ? handlers.onUp : handlers.onDown)?.(e);
  };

  const cancel = () => {
    start = null;
    el.style.transform = el.style.opacity = "";
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
  };
}
