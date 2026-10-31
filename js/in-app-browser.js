// Browsers inside other apps (a link opened in Telegram, Instagram, ...) keep
// their own storage, apart from the user's browser and the installed app, so
// playlists and sync there start empty. Found from the user agent; an in-app
// browser that shows the plain Safari or Chrome user agent can't be found.

const APPS = /FBAN|FBAV|FB_IAB|Instagram|\bLine\/|LinkedInApp|Snapchat|MicroMessenger|musical_ly|BytedanceWebview|Telegram|Pinterest|Twitter|Discord|GSA\//;

// `webView`: the page can send messages to the app around it, which only an
// app's WebView allows (window.webkit.messageHandlers on iOS). Some apps,
// Telegram on iOS for one, give their WebView the full Safari user agent.
export function isInAppBrowser(ua, { standalone = false, webView = false } = {}) {
  if (standalone) return false;   // the installed app on iOS also has no "Safari/"
  return webView || APPS.test(ua)
    || /; wv\)/.test(ua)                                           // Android WebView
    || (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua));      // iOS WKWebView
}

// A link that asks the system to open `href` in the user's browser, or null
// where no such link exists. Android intent links use the #fragment for
// themselves, so there the page opens without it.
export function browserLink(href, ua) {
  const url = new URL(href);
  if (/iPhone|iPad|iPod/.test(ua)) return `x-safari-${url.href}`;   // iOS 17 and later
  if (/Android/.test(ua)) return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.slice(0, -1)};end`;
  return null;
}
