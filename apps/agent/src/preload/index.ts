import { contextBridge, ipcRenderer } from "electron";
import { createAgentRendererApi } from "./api";

contextBridge.exposeInMainWorld("cryptoBotAgent", createAgentRendererApi((channel, ...args) => ipcRenderer.invoke(channel, ...args)));
