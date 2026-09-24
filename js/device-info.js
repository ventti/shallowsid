// A plain description of this device for the Sync sheet's device list:
// OS, browser, whether it runs as an installed app, and a rough place.
//
// The place comes from the time zone (Europe/Helsinki -> "Helsinki"): no
// permission prompt, no location lookup, and only as precise as the zone. It
// is stored encrypted with the rest of the sync data.

export function describeOS(ua, platform = "") {
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua))) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Windows/.test(ua) || platform === "Windows") return "Windows";
  if (/Mac OS X|Macintosh/.test(ua) || platform === "macOS") return "macOS";
  if (/Linux/.test(ua) || platform === "Linux") return "Linux";
  return platform || "Unknown device";
}

// Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari".
export function describeBrowser(ua) {
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS/.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS/.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

export function placeFromTimeZone(timeZone) {
  const city = String(timeZone ?? "").split("/").pop();
  return city && city !== "UTC" && !/^Etc$|^GMT/.test(city) ? city.replace(/_/g, " ") : "";
}

export function describeDevice() {
  const ua = globalThis.navigator?.userAgent ?? "";
  const installed = ["standalone", "fullscreen", "minimal-ui"].some((m) => globalThis.matchMedia?.(`(display-mode: ${m})`).matches)
    || globalThis.navigator?.standalone === true;
  let timeZone = "";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // no Intl time zones: leave the place out
  }
  return {
    os: describeOS(ua, globalThis.navigator?.userAgentData?.platform),
    browser: describeBrowser(ua),
    app: installed,
    place: placeFromTimeZone(timeZone),
  };
}
