import type { PowerSyncCredentials } from "./index";

export interface DesktopApi {
  powersync: {
    connect: (credentials: PowerSyncCredentials) => Promise<void>;
    disconnect: () => Promise<void>;
  };
}

declare global {
  interface Window {
    api: DesktopApi;
  }
}
