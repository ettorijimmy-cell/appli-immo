import { join } from "path";
import { Worker } from "node:worker_threads";
import { PowerSyncDatabase } from "@powersync/node";
import { app } from "electron";
import { AppConnector } from "./connector";
import { setStoredCredentials, type StoredPowerSyncCredentials } from "./credentials-store";
import { AppSchema } from "./schema";

// Fichier SQLite local géré par PowerSync — dossier de données utilisateur
// Electron, jamais dans le repo. Chiffré (SQLite3MultipleCiphers via
// better-sqlite3-multiple-ciphers, voir docs/data-dictionary.md section
// Sécurité PowerSync) — clé résolue une seule fois au démarrage
// (voir encryption-key.ts) et injectée ici via setEncryptionKey(), avant
// toute connexion.
let db: PowerSyncDatabase | null = null;
let connected = false;
let encryptionKey: string | null = null;

export function setEncryptionKey(key: string): void {
  encryptionKey = key;
}

function getDb(): PowerSyncDatabase {
  if (!encryptionKey) {
    throw new Error(
      "Clé de chiffrement PowerSync non initialisée — setEncryptionKey() doit être appelé (voir main/index.ts) avant toute connexion."
    );
  }
  const cle = encryptionKey;

  db ??= new PowerSyncDatabase({
    schema: AppSchema,
    database: {
      dbFilename: join(app.getPath("userData"), "powersync.db"),
      // Worker séparé (database.worker.ts, entrée de build dédiée — voir
      // electron.vite.config.ts) : remplace le driver SQLite par défaut
      // par le fork chiffré. __dirname pointe vers out/main en production
      // comme en dev (même pattern que le chemin du preload ci-dessous).
      // workerData transmet la clé de chiffrement : nécessaire pour que
      // database.worker.ts puisse la poser dès le constructeur de la base
      // (voir le commentaire "CONTOURNEMENT NON OFFICIEL" dans ce fichier) —
      // avant, elle ne transitait que via initializeConnection ci-dessous,
      // ce qui s'est révélé trop tardif.
      openWorker: (_filename, options) =>
        new Worker(join(__dirname, "powersync-worker.js"), { ...options, workerData: { encryptionKey: cle } }),
      initializeConnection: async (connexion) => {
        // La clé est désormais posée dans database.worker.ts, avant
        // l'ouverture — pas ici. Ce contrôle reste utile en tant que
        // garde-fou côté thread principal : échoue immédiatement si la
        // connexion n'est pas réellement déchiffrée.
        await connexion.execute("pragma user_version");
      }
    }
  });
  return db;
}

export async function connectPowerSync(credentials: StoredPowerSyncCredentials): Promise<void> {
  setStoredCredentials(credentials);
  const database = getDb();
  if (!connected) {
    await database.connect(new AppConnector());
    connected = true;
  }
}

export async function disconnectPowerSync(): Promise<void> {
  setStoredCredentials(null);
  if (db && connected) {
    await db.disconnect();
    connected = false;
  }
}
