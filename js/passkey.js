// Passkeys for sync. A passkey's PRF extension gives the same secret in every
// browser, installed app and profile that can use the passkey (they share it
// through the platform's password manager), so the secret can find and open
// a record that holds the sync key (see savePasskey/usePasskey in sync.js).
// There is no server check: the passkey is only a key store, not a login.

const enc = new TextEncoder();
const SALT = enc.encode("shallowsid-sync-key-v1");
const USER_ID = enc.encode("shallowsid-sync");   // fixed: saving again replaces the site's passkey, not adds one
const random = () => crypto.getRandomValues(new Uint8Array(32));
const prf = { prf: { eval: { first: SALT } } };

const unsupported = () => new Error("This browser can't keep the sync key in a passkey. Use the key or the QR code instead.");
// Faster than a person can cancel: the browser refused without showing a passkey window.
const REFUSED_MS = 1000;

// Thrown when the browser refuses passkeys, as browsers inside other apps do.
export class PasskeyBlocked extends Error {}

export async function canUsePasskeys() {
  if (!globalThis.PublicKeyCredential || !globalThis.isSecureContext) return false;
  try {
    return (await PublicKeyCredential.getClientCapabilities?.())?.["extension:prf"] !== false;
  } catch {
    return true;   // unknown: try, and report if it fails
  }
}

// The passkey's secret (32 bytes), or null when the user cancelled. `create`
// makes the passkey first.
export async function passkeySecret({ create = false } = {}) {
  const started = Date.now();
  try {
    let id = null;
    if (create) {
      const credential = await navigator.credentials.create({ publicKey: {
        rp: { name: "ShallowSID" },
        user: { id: USER_ID, name: "ShallowSID sync key", displayName: "ShallowSID sync key" },
        challenge: random(),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        extensions: prf,
      } });
      const result = credential.getClientExtensionResults().prf;
      if (result?.results?.first) return new Uint8Array(result.results.first);
      if (!result?.enabled) throw unsupported();
      id = credential.rawId;   // some browsers give the secret only when the passkey is used
    }
    const credential = await navigator.credentials.get({ publicKey: {
      challenge: random(),
      userVerification: "required",
      allowCredentials: id ? [{ type: "public-key", id }] : [],
      extensions: prf,
    } });
    const first = credential.getClientExtensionResults().prf?.results?.first;
    if (!first) throw unsupported();
    return new Uint8Array(first);
  } catch (err) {
    // shortcut: a time limit tells a refusal from a cancel, use a better signal when browsers give one
    if (err.name === "NotAllowedError" && Date.now() - started < REFUSED_MS) throw new PasskeyBlocked("This browser can't use passkeys");
    if (["NotAllowedError", "AbortError"].includes(err.name)) return null;
    throw err;
  }
}
