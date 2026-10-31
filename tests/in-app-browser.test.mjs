import { test } from "node:test";
import assert from "node:assert/strict";
import { browserLink, isInAppBrowser } from "../js/in-app-browser.js";

const UA = {
  iPhoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iPhoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
  iPhoneFirefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15",
  iPhoneWebView: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  iPhoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidWebView: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  androidTelegram: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Telegram-Android/11.0",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

test("in-app browsers are found; real browsers and the installed app are not", () => {
  for (const ua of [UA.iPhoneWebView, UA.iPhoneInstagram, UA.androidWebView, UA.androidTelegram]) assert.ok(isInAppBrowser(ua), ua);
  for (const ua of [UA.iPhoneSafari, UA.androidChrome, UA.macChrome]) assert.ok(!isInAppBrowser(ua), ua);
  assert.ok(!isInAppBrowser(UA.iPhoneWebView, { standalone: true }));
  assert.ok(isInAppBrowser(UA.iPhoneSafari, { webView: true }));   // a WebView with the full Safari user agent
});

test("other browsers on iOS are not in-app browsers, though they are WebViews", () => {
  for (const ua of [UA.iPhoneChrome, UA.iPhoneFirefox]) assert.ok(!isInAppBrowser(ua, { webView: true }), ua);
});

test("links to the system browser on iOS and Android, none elsewhere", () => {
  const href = "https://sid.extend.fi/app/?x=1#/p/abc";
  assert.equal(browserLink(href, UA.iPhoneWebView), "x-safari-https://sid.extend.fi/app/?x=1#/p/abc");
  assert.equal(browserLink(href, UA.androidWebView), "intent://sid.extend.fi/app/?x=1#Intent;scheme=https;end");
  assert.equal(browserLink(href, UA.macChrome), null);
});
