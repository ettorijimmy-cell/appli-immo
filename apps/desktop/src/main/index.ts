import { join } from "path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { ecrireFichierTemporaire, viderDossierTemporaire } from "./documents-temp";
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

// Ouvre un .docx (généré — bail/quittance/état des lieux — ou uploadé dans
// le module Documents) avec l'application par défaut du système, plutôt
// que l'ancien mécanisme de téléchargement navigateur forcé (<a download>).
// Le renderer ne peut ni écrire de fichier ni appeler shell.openPath
// lui-même (sandbox: true, nodeIntegration: false) : il transmet le buffer
// déjà récupéré via authenticatedFetchBlob, jamais un chemin. Le fichier
// reste en clair sur disque (nécessaire pour qu'une application externe
// puisse le lire) — accepté en connaissance de cause, voir
// viderDossierTemporaire ci-dessus/ci-dessous pour le nettoyage.
// ecrireFichierTemporaire() valide l'extension .docx avant toute écriture
// (défense en profondeur, même principe que la validation de protocole sur
// shell:openExternal ci-dessus). shell.openPath() ne rejette jamais : il
// résout avec une chaîne vide en cas de succès, ou un message d'erreur
// sinon (ex. aucune application associée à .docx) — transformé ici en
// rejet de promesse pour que le renderer puisse afficher un message clair
// plutôt qu'un échec silencieux.
ipcMain.handle("documents:ouvrirTemporaire", async (_event, buffer: ArrayBuffer, nomFichier: string) => {
  const chemin = await ecrireFichierTemporaire(app.getPath("temp"), nomFichier, Buffer.from(buffer));
  const erreur = await shell.openPath(chemin);
  if (erreur) {
    throw new Error(`Impossible d'ouvrir "${nomFichier}" avec l'application par défaut du système : ${erreur}`);
  }
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

  // Purge complète du dossier temporaire dédié aux .docx ouverts par
  // documents:ouvrirTemporaire — jamais un nettoyage après ouverture (Word
  // garde le fichier verrouillé tant qu'il reste ouvert), donc le seul
  // moment sûr est avant toute nouvelle écriture, au lancement suivant. Ne
  // bloque pas le démarrage sur un échec (permissions, dossier déjà
  // verrouillé par un antivirus...) : contrairement à l'échec de
  // déchiffrement PowerSync ci-dessus, un reliquat de fichiers temporaires
  // .docx n'est jamais bloquant pour l'usage de l'app.
  try {
    await viderDossierTemporaire(app.getPath("temp"));
  } catch (error) {
    console.error("Échec du nettoyage du dossier temporaire de documents :", error);
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
