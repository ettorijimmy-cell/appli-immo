import { contextBridge, ipcRenderer } from "electron";

export interface PowerSyncCredentials {
  token: string;
  endpoint: string;
}

const api = {
  powersync: {
    connect: (credentials: PowerSyncCredentials): Promise<void> =>
      ipcRenderer.invoke("powersync:connect", credentials),
    disconnect: (): Promise<void> => ipcRenderer.invoke("powersync:disconnect")
  }
};

contextBridge.exposeInMainWorld("api", api);
