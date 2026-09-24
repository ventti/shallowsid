// Public Firebase settings for the optional sync. Nothing here is secret: the
// API key only identifies the project, and firestore.rules decide what anyone
// can do with it. Leave empty to hide sync entirely. An optional `endpoint`
// points at a Firestore emulator for local testing.
export const FIREBASE = {
  apiKey: "AIzaSyCVTyHPNGHCgDpPWL3wQ_kX-79xQE5XIQs", // gitleaks:allow (public Firebase web key; access is governed by firestore.rules)
  projectId: "shallowsid",
};
