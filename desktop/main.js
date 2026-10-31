// Ilelah Business Suite for Windows: a thin desktop shell around the same app that runs on the phone.
// Shop records live in this PC's own app data folder (they survive updates and uninstalling).
const { app, BrowserWindow, Menu, protocol, net, shell, session, dialog } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const fs = require("fs");
const WWW = fs.existsSync(path.join(__dirname, "www")) ? path.join(__dirname, "www") : path.join(__dirname, "..", "www");
const SCHEME = "ilelah";
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); }
let win = null;
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 600,
    backgroundColor: "#F5F7FA", title: "Ilelah Business Suite", autoHideMenuBar: true,
    icon: app.isPackaged ? path.join(process.resourcesPath, "icon.ico") : path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.maximize();
  win.loadURL(`${SCHEME}://app/index.html`);
  // WhatsApp / web links open in the normal browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?|mailto|tel|sms|whatsapp):/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(`${SCHEME}://`)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.on("closed", () => { win = null; });
  if (process.env.ILELAH_TEST) win.webContents.on("did-finish-load", () => process.send && process.send("loaded"));
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname); if (rel === "/" || rel === "") rel = "/index.html";
    const file = path.normalize(path.join(WWW, rel));
    if (!file.startsWith(WWW)) return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Camera (barcode scanning) is allowed; nothing else.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === "media" || perm === "clipboard-sanitized-write"));
  // Saving a backup / Excel / receipt: ask where to save, like any Windows program.
  session.defaultSession.on("will-download", (_e, item) => { /* default save dialog */ });
  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => app.quit());
