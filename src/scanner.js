// Camera barcode scanning (works offline, no Google services needed).
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";

// Retail formats only: faster and fewer false reads than "everything".
export const SCAN_FORMATS = [
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE,
];
export function makeHints() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}

// Starts the rear camera in <video> and calls onCode(text) for every read.
// Returns { stop(), torchSupported, setTorch(on) }.
export async function startScanner(video, onCode) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const e = new Error("Camera is not available."); e.name = "NoMediaDevices"; throw e;
  }
  const reader = new BrowserMultiFormatReader(makeHints(), { delayBetweenScanAttempts: 60, delayBetweenScanSuccess: 200 });
  const constraints = {
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: "continuous" }] },
  };
  const controls = await reader.decodeFromConstraints(constraints, video, (result) => {
    if (result) onCode(result.getText());
  });
  let track = null;
  try { track = video.srcObject && video.srcObject.getVideoTracks()[0]; } catch (e) {}
  let torchSupported = false;
  try { torchSupported = !!(track && track.getCapabilities && track.getCapabilities().torch); } catch (e) {}
  return {
    stop: () => { try { controls.stop(); } catch (e) {} try { video.srcObject && video.srcObject.getTracks().forEach((t) => t.stop()); } catch (e) {} },
    torchSupported,
    setTorch: async (on) => { if (track) await track.applyConstraints({ advanced: [{ torch: on }] }); },
  };
}

// Short beep (ok) or low buzz (not ok) + vibration, so the cashier doesn't have to look at the screen.
let audioCtx = null;
export function feedback(ok) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      audioCtx = audioCtx || new AC();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = ok ? "sine" : "square"; o.frequency.value = ok ? 1100 : 220;
      g.gain.value = 0.15; o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + (ok ? 0.09 : 0.25));
    }
  } catch (e) {}
  try { navigator.vibrate && navigator.vibrate(ok ? 40 : [60, 40, 60]); } catch (e) {}
}
