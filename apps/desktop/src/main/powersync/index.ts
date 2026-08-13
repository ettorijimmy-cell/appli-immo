import { join } from "path";
import { PowerSyncDatabase } from "@powersync/node";
import { app } from "electron";
import { AppConnector } from "./connector";
import { setStoredCredentials, type StoredPowerSyncCredentials } from "./credentials-store";
import { AppSchema } from "./schema";

// Fichier SQLite local géré par PowerSync — dossier de données utilisateur
// Electron, jamais dans le repo. Chiffrement au repos (SQLite3MultipleCiphers,
// voir docs/integrations.md) volontairement différé pour ce premier test de
// connectivité minimal : à traiter avant toute extension au-delà de la
// table scis (voir docs/backlog.md, chantier PowerSync).
let db: PowerSyncDatabase | null = null;
let connected = false;

function getDb(): PowerSyncDatabase {
  db ??= new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: join(app.getPath("userData"), "powersync.db") }
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
