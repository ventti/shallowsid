// Sync key as a QR code: draw it (a link that opens ShallowSID and joins) and
// read it back with the camera. The key rides in the #fragment, which browsers
// never send to a server. Both libraries load from the CDN on first use.

const QRCODE_URL = "https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.mjs";
const JSQR_URL = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm";
const SCAN_INTERVAL_MS = 150;
const SCAN_WIDTH = 640;   // frames are scaled down to this before decoding

export const syncLink = (key) => new URL(`#/sync/${key}`, location.href).href;

// The key from a scanned link, or the text itself (a bare key).
export function keyFromText(text) {
  return String(text).match(/#\/sync\/([\w-]+)/)?.[1] ?? String(text).trim();
}

export async function qrSvg(text) {
  const { qrcode } = await import(QRCODE_URL);
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true, alt: "Sync key QR code" });
}

export const canScan = () => !!navigator.mediaDevices?.getUserMedia;

// Native BarcodeDetector where the browser has it (Chrome, Android), else jsQR.
async function createDecoder() {
  if ("BarcodeDetector" in window && (await BarcodeDetector.getSupportedFormats()).includes("qr_code")) {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import(JSQR_URL);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    const scale = Math.min(1, SCAN_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(data, width, height, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

// Show the camera until a QR code passes `accept`; resolves its text, or null
// when cancelled. Throws when the camera can't be opened.
export async function scanQR(accept = () => true) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  const modal = document.createElement("ion-modal");
  modal.innerHTML = `
    <ion-header>
      <ion-toolbar>
        <ion-title>Scan Sync Key</ion-title>
        <ion-buttons slot="end"><ion-button class="qr-cancel">Cancel</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="sound-content">
      <div class="qr-scan"><video playsinline muted></video></div>
      <p class="sound-note">Point the camera at the QR code in <strong>Sync</strong> on your other device.</p>
    </ion-content>`;
  document.body.appendChild(modal);
  const video = modal.querySelector("video");
  video.srcObject = stream;
  modal.querySelector(".qr-cancel").addEventListener("click", () => modal.dismiss());

  let result = null, timer = 0, done = false;
  modal.addEventListener("didDismiss", () => {
    done = true;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    setTimeout(() => modal.remove(), 0);
  });
  const closed = new Promise((resolve) => modal.addEventListener("didDismiss", () => resolve(result)));

  await modal.present();
  try {
    const [decode] = await Promise.all([createDecoder(), video.play()]);
    const tick = async () => {
      if (done) return;
      const text = video.readyState >= 2 ? await decode(video).catch(() => null) : null;
      if (text && accept(text)) {
        result = text;
        return modal.dismiss();
      }
      timer = setTimeout(tick, SCAN_INTERVAL_MS);
    };
    tick();
  } catch (err) {
    modal.dismiss();
    throw err;
  }
  return closed;
}
