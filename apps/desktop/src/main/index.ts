import { join } from "path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { connectPowerSync, disconnectPowerSync, setEncryptionKey } from "./powersync";
import type { StoredPowerSyncCredentials } from "./powersync/credentials-store";
import { initializePowerSyncEncryption } from "./powersync/encryption-key";

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  // Aucun contenu web distant : toute navigation externe s'ouvre dans le
  // navigateur système plutôt que dans la fenêtre de l'application.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// IPC : le renderer obtient le jeton PowerSync via GET /powersync/token
// (authentifié avec le JWT applicatif, jamais accessible depuis le
// processus principal directement) puis le transmet ici — le SDK Node
// PowerSync tourne dans le processus principal (voir docs/integrations.md),
// pas le renderer.
ipcMain.handle("powersync:connect", async (_event, credentials: StoredPowerSyncCredentials) => {
  await connectPowerSync(credentials);
});

ipcMain.handle("powersync:disconnect", async () => {
  await disconnectPowerSync();
});

// IPC générique (pas spécifique à Gmail) : ouvre une URL dans le navigateur
// système, jamais dans une fenêtre Electron interne — même mécanisme que
// setWindowOpenHandler ci-dessus, mais déclenchable depuis le renderer
// (consentement OAuth Google, Module Tâches Étape 3). Restreint à http(s)
// pour qu'un appelant renderer ne puisse pas faire ouvrir un schéma
// arbitraire (file:, etc.) via ce canal.
ipcMain.handle("shell:openExternal", async (_event, url: string) => {
  const { protocol } = new URL(url);
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error("URL non autorisée");
  }
  await shell.openExternal(url);
});

void app.whenReady().then(async () => {
  // Résolu avant toute fenêtre : un échec ici (safeStorage indisponible,
  // clé indéchiffrable) doit bloquer le démarrage, jamais laisser l'app
  // s'ouvrir avec une base locale non protégée ou une nouvelle clé
  // régénérée en silence — voir docs/backlog.md, chantier PowerSync.
  try {
    const cle = await initializePowerSyncEncryption();
    setEncryptionKey(cle);
  } catch (error) {
    dialog.showErrorBox(
      "Erreur de chiffrement",
      error instanceof Error ? error.message : String(error)
    );
    app.quit();
    return;
  }

  electronApp.setAppUserModelId("com.appli-immo.desktop");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
