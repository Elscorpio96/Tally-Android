import { Capacitor, registerPlugin } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";
import { AppLauncher } from "@capacitor/app-launcher";

const isNative = Capacitor.isNativePlatform();

// Save text to a temp file and open the Android share sheet
// (Save to Drive / Files, WhatsApp, email, Bluetooth, ...).
// In a normal browser it falls back to a regular download.
export async function saveAndShare(filename, text, mime) {
  if (!isNative) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }
  const written = await Filesystem.writeFile({
    path: filename,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  try {
    await Share.share({ title: filename, url: written.uri, dialogTitle: "Save or share" });
  } catch (e) {
    // user closed the share sheet: nothing to do
  }
}

// Save a binary file (e.g. .xlsx) given as base64, then open the share sheet.
export async function saveAndShareBase64(filename, base64, mime) {
  if (!isNative) {
    const bin = atob(base64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    return;
  }
  const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
  try { await Share.share({ title: filename, url: written.uri, dialogTitle: "Save or share" }); } catch (e) {}
}

// Open WhatsApp / the SMS app / a web link outside the app.
export async function openExternal(url) {
  try {
    if (isNative) await AppLauncher.openUrl({ url });
    else window.open(url, "_blank");
    return true;
  } catch (e) { return false; }
}

export async function shareText(text) {
  try {
    if (isNative) await Share.share({ text });
    else if (navigator.share) await navigator.share({ text });
    else await navigator.clipboard.writeText(text);
  } catch (e) {}
}

if (isNative) {
  // window.print() does nothing inside an Android WebView, so route it to
  // Android's own print dialog (print to a printer or "Save as PDF").
  // The app's existing print CSS makes it print only the receipt.
  const Printer = registerPlugin("TallyPrint");
  window.print = () => {
    Printer.print({ name: "Receipt" }).catch((e) => console.error("print failed", e));
  };

  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  StatusBar.setBackgroundColor({ color: "#F4F3EE" }).catch(() => {});
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
}
