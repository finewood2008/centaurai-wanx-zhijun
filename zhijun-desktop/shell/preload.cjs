const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("zhijunDesktop", {
  connection: () => ipcRenderer.invoke("zhijun:connection"),
});
async function speechCall(method, payload) {
  const response = await ipcRenderer.invoke(`zhijun:speech:${method}`, payload);
  if (!response.ok) {
    const error = new Error(response.message);
    error.code = response.code;
    throw error;
  }
  return response.result;
}
contextBridge.exposeInMainWorld("zhijunSpeech", {
  capability: () => speechCall("capability"),
  authorize: () => speechCall("authorize"),
  transcribe: (payload) => speechCall("transcribe", payload),
  cancel: (payload) => speechCall("cancel", payload),
});
