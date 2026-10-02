const { app, BrowserWindow, Menu, ipcMain, dialog } = require("electron");
const path = require("node:path");
const { startServer, localService } = require("./server.cjs");
const { installMicrophonePermissions } = require("./permissions.cjs");
const { createNativeSpeech } = require("./native-speech.cjs");
app.setName("知君");
// The old Zhijun clients and WANX keep their own sessions and data directories.
app.setPath(
  "userData",
  process.env.ZHIJUN_USER_DATA ||
    path.join(app.getPath("appData"), "Zhijun-WANX"),
);
let window, service, speech;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      const upstream = localService(
        process.env.ZHIJUN_WANX_URL || "http://127.0.0.1:8088",
      ).origin;
      service = await startServer({
        root: path.join(__dirname, "../dist"),
        upstream,
        port: Number(process.env.ZHIJUN_UI_PORT || 28631),
      });
      ipcMain.handle("zhijun:connection", (event) => {
        if (
          event.senderFrame !== window.webContents.mainFrame ||
          new URL(event.senderFrame.url).origin !== service.origin
        )
          throw new Error("Untrusted frame");
        return { url: upstream, version: app.getVersion() };
      });
      speech = createNativeSpeech({
        helperPath: path.join(__dirname, "native/bin/zhijun-speech"),
      });
      for (const method of [
        "capability",
        "authorize",
        "transcribe",
        "cancel",
      ]) {
        ipcMain.handle(`zhijun:speech:${method}`, async (event, payload) => {
          if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            new URL(event.senderFrame.url).origin !== service.origin
          )
            throw new Error("Untrusted frame");
          try {
            return { ok: true, result: await speech[method](payload) };
          } catch (error) {
            return {
              ok: false,
              code: error.code || "speech_unavailable",
              message: error.message,
            };
          }
        });
      }
      window = new BrowserWindow({
        width: 1180,
        height: 820,
        minWidth: 760,
        minHeight: 600,
        backgroundColor: "#fffcf6",
        title: "知君",
        titleBarStyle: "hiddenInset",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: "persist:zhijun-wanx",
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== service.origin) event.preventDefault();
      });
      installMicrophonePermissions(window.webContents, service.origin);
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "知君",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "quit" },
            ],
          },
          {
            label: "编辑",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "显示",
            submenu: [
              { role: "reload" },
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
              { role: "togglefullscreen" },
            ],
          },
        ]),
      );
      await window.loadURL(service.origin);
    })
    .catch((error) => {
      dialog.showErrorBox("知君未能启动", error.message);
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    speech?.dispose();
    service?.close();
  });
}
