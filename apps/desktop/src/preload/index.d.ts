// Élargi au fil des canaux IPC ajoutés (connexion PowerSync, etc.).
export type DesktopApi = Record<string, never>;

declare global {
  interface Window {
    api: DesktopApi;
  }
}
