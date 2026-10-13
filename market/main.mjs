import { app, BrowserWindow, Menu, dialog, session } from "electron";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { startHostRuntime } from "../server/host-runtime.mjs";

// WANX supplies the application-specific userData directory and one-time host
// credentials. This entry never initializes a second account or device network.
let runtime;
let window;
let closing = false;

async function closeRuntime() {
  if (closing) return;
  closing = true;
  try { await runtime?.close(); }
  finally { runtime = undefined; app.quit(); }
}

// Handle the manager signal before Electron starts its native quit path.
// Cancelling a native SIGTERM quit and re-entering app.quit can leave it pending.
process.on("SIGTERM", () => { void closeRuntime(); });

app.on("window-all-closed", () => { void closeRuntime(); });
app.on("before-quit", (event) => {
  if (runtime && !closing) { event.preventDefault(); void closeRuntime(); }
});

await app.whenReady();
try {
  if (process.platform === "darwin") {
    app.dock?.setIcon(fileURLToPath(new URL("../resources/icon.png", import.meta.url)));
    app.dock?.show();
  }
  runtime = await startHostRuntime({
    dataDir: app.getPath("userData"),
    staticDir: fileURLToPath(new URL("../renderer/", import.meta.url)),
    environment: process.env,
  });
  const isolated = session.fromPartition(`zhijun-host-${randomUUID()}`);
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  const origin = new URL(runtime.origin).origin;
  isolated.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*", "file:///*"] }, (details, callback) => {
    const target = new URL(details.url);
    const allowed = target.origin === origin || (target.protocol === "ws:" && `http://${target.host}` === origin);
    callback({ cancel: !allowed });
  });
  await isolated.cookies.set(runtime.bootstrapCookie);
  window = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 640,
    title: "知君", backgroundColor: "#f7f5f0", show: false,
    ...(process.platform === "win32" ? { icon: fileURLToPath(new URL("../resources/icon.ico", import.meta.url)) } : {}),
    webPreferences: {
      session: isolated, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  if (process.platform === "win32") {
    Menu.setApplicationMenu(null);
    window.setMenu(null);
    window.setMenuBarVisibility(false);
  }
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  window.on("closed", () => { window = undefined; void closeRuntime(); });
  window.once("ready-to-show", () => window?.show());
  const entry = new URL(runtime.url);
  entry.searchParams.set("managedHost", "1");
  await window.loadURL(entry.href);
} catch {
  dialog.showErrorBox("无法打开知君", "请回到万象，确认已登录并连接盒子，然后重新打开知君。");
  await closeRuntime();
}
