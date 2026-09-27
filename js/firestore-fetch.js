// fetch() for Firestore's REST API with a Firebase App Check token, so the
// database only answers this site (Firestore enforces App Check). The token
// comes from invisible reCAPTCHA v3; the Firebase SDK that gets it loads on
// the first Firestore request, so playing tunes never touches Google.
//
// Without `recaptchaSiteKey` in the config, or with an emulator `endpoint`,
// requests go out as plain fetch() (tests, local emulator).

const SDK = "https://www.gstatic.com/firebasejs/12.19.0";

let appCheck = null;   // Promise of the App Check instance, shared by all callers

function loadAppCheck(config) {
  appCheck ??= (async () => {
    // On localhost the SDK logs a debug token to register in the Firebase console.
    if (["localhost", "127.0.0.1"].includes(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    const [{ initializeApp }, { initializeAppCheck, ReCaptchaV3Provider }] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-app-check.js`),
    ]);
    const app = initializeApp({ apiKey: config.apiKey, projectId: config.projectId, appId: config.appId });
    return initializeAppCheck(app, { provider: new ReCaptchaV3Provider(config.recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
  })().catch((err) => {
    appCheck = null;   // offline or blocked: try again next time
    throw err;
  });
  return appCheck;
}

async function appCheckToken(config) {
  const instance = await loadAppCheck(config);
  const { getToken } = await import(`${SDK}/firebase-app-check.js`);
  try {
    return (await getToken(instance)).token;
  } catch (err) {
    console.error("app check:", err);
    throw new Error("This browser couldn't be verified for sync; reload the page and try again");
  }
}

export async function firestoreFetch(config, url, init = {}) {
  if (!config.recaptchaSiteKey || config.endpoint) return fetch(url, init);
  const token = await appCheckToken(config);
  return fetch(url, { ...init, headers: { ...init.headers, "X-Firebase-AppCheck": token } });
}
