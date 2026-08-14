import Database from "better-sqlite3-multiple-ciphers";
import { startPowerSyncWorker } from "@powersync/node/worker.js";

// Fichier de worker séparé requis par PowerSync pour remplacer le driver
// SQLite par défaut (better-sqlite3) par le fork chiffré
// better-sqlite3-multiple-ciphers — voir docs/data-dictionary.md, section
// Sécurité PowerSync. Entrée de build dédiée (voir electron.vite.config.ts),
// jamais importée statiquement ailleurs : chargée dynamiquement via
// openWorker dans powersync/index.ts.
startPowerSyncWorker({ loadBetterSqlite3: async () => Database });
