import { test } from "node:test";
import assert from "node:assert/strict";
import { describeBrowser, describeOS, placeFromTimeZone } from "../js/device-info.js";

const UA = {
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iPhoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1",
  iPadSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
};

test("OS and browser from the user agent", () => {
  assert.deepEqual([describeOS(UA.macChrome), describeBrowser(UA.macChrome)], ["macOS", "Chrome"]);
  assert.deepEqual([describeOS(UA.macSafari), describeBrowser(UA.macSafari)], ["macOS", "Safari"]);
  assert.deepEqual([describeOS(UA.iPhoneChrome), describeBrowser(UA.iPhoneChrome)], ["iPhone", "Chrome"]);
  assert.deepEqual([describeOS(UA.iPadSafari), describeBrowser(UA.iPadSafari)], ["iPad", "Safari"]);
  assert.deepEqual([describeOS(UA.androidFirefox), describeBrowser(UA.androidFirefox)], ["Android", "Firefox"]);
  assert.deepEqual([describeOS(UA.winEdge), describeBrowser(UA.winEdge)], ["Windows", "Edge"]);
});

test("place is the time zone's city, or nothing", () => {
  assert.equal(placeFromTimeZone("Europe/Helsinki"), "Helsinki");
  assert.equal(placeFromTimeZone("America/New_York"), "New York");
  assert.equal(placeFromTimeZone("UTC"), "");
  assert.equal(placeFromTimeZone("Etc/GMT+2"), "");
  assert.equal(placeFromTimeZone(undefined), "");
});
