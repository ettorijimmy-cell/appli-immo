import type { PowerSyncCredentials } from "./index";

export interface DesktopApi {
  powersync: {
    connect: (credentials: PowerSyncCredentials) => Promise<void>;
    disconnect: () => Promise<void>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
}

declare global {
  interface Window {
    api: DesktopApi;
  }
}
