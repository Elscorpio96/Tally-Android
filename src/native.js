import { Capacitor, registerPlugin } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";

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
    Printer.print({ name: "Tally receipt" }).catch((e) => console.error("print failed", e));
  };

  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  StatusBar.setBackgroundColor({ color: "#F4F3EE" }).catch(() => {});
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
}
