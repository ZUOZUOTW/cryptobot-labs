import { contextBridge, ipcRenderer } from "electron";
import { createAgentRendererApi } from "./api";

contextBridge.exposeInMainWorld("cryptoBotAgent", createAgentRendererApi(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  (channel, listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
));
