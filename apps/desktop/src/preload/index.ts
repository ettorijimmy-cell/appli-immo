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
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url)
  },
  documents: {
    ouvrirTemporaire: (buffer: ArrayBuffer, nomFichier: string): Promise<void> =>
      ipcRenderer.invoke("documents:ouvrirTemporaire", buffer, nomFichier)
  }
};

contextBridge.exposeInMainWorld("api", api);
