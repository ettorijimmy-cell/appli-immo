import { contextBridge } from "electron";

// Point d'extension pour les futurs canaux IPC (connexion PowerSync, etc.).
const api = {};

contextBridge.exposeInMainWorld("api", api);
