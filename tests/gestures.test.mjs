import { test } from "node:test";
import assert from "node:assert/strict";
import { preventDoubleTapZoom } from "../js/gestures.js";

function setup() {
  const handlers = {};
  preventDoubleTapZoom({ addEventListener(name, handler, options) {
    handlers[name] = handler;
    if (name === "touchend") assert.equal(options.passive, false);
  } });
  let clicks = 0;
  const target = { click() { clicks++; } };
  const touch = { clientX: 40, clientY: 50 };
  const tap = (timeStamp, options = {}) => {
    handlers.touchstart({ touches: [touch] });
    let prevented = false;
    handlers.touchend({ timeStamp, touches: [], changedTouches: [touch], cancelable: true,
      composedPath: () => [target], preventDefault() { prevented = true; }, ...options });
    return prevented;
  };
  return { handlers, tap, touch, clicks: () => clicks };
}

test("second nearby tap blocks zoom and retains exactly one click", () => {
  const { tap, clicks } = setup();
  assert.equal(tap(0), false);
  assert.equal(tap(200), true);
  assert.equal(clicks(), 1);
  assert.equal(tap(1000), false);
});

test("distant taps and non-cancelable events retain native behavior", () => {
  const { tap, touch, clicks } = setup();
  tap(0);
  touch.clientX += 100;
  assert.equal(tap(100), false);
  assert.equal(tap(200, { cancelable: false }), false);
  assert.equal(clicks(), 0);
});

for (const event of ["touchmove", "touchcancel", "touchstart"]) {
  test(`${event} interrupts a double tap without blocking scrolling or pinch`, () => {
    const { handlers, tap } = setup();
    tap(0);
    handlers[event]({ touches: [{}, {}] });
    assert.equal(tap(200), false);
  });
}

test("an already handled touch does not receive a second click", () => {
  const { tap, clicks } = setup();
  tap(0);
  assert.equal(tap(100, { defaultPrevented: true }), false);
  assert.equal(clicks(), 0);
  assert.equal(tap(200), false);
});
