// Public Firebase settings for the optional sync. Nothing here is secret: the
// API key only identifies the project, and firestore.rules decide what anyone
// can do with it. Leave empty to hide sync entirely. An optional `endpoint`
// points at a Firestore emulator for local testing.
export const FIREBASE = {
  apiKey: "AIzaSyCVTyHPNGHCgDpPWL3wQ_kX-79xQE5XIQs", // gitleaks:allow (public Firebase web key; access is governed by firestore.rules)
  projectId: "shallowsid",
  // App Check (see firestore-fetch.js): the web app's id and a reCAPTCHA v3
  // site key, both public. Left empty, requests go out without App Check.
  appId: "1:1034165461122:web:57e9b7a290dc7e88d1149b",
  recaptchaSiteKey: "6LdDP9ItAAAAAO0ZV8CfA1vKW48aeJI0yxGdj9Iy",
};
