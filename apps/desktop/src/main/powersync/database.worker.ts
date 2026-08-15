import Database from "better-sqlite3-multiple-ciphers";
import { startPowerSyncWorker } from "@powersync/node/worker.js";
import { workerData } from "node:worker_threads";

interface DatabaseAvecPragma {
  pragma(source: string): unknown;
}

// Fichier de worker séparé requis par PowerSync pour remplacer le driver
// SQLite par défaut (better-sqlite3) par le fork chiffré
// better-sqlite3-multiple-ciphers — voir docs/data-dictionary.md, section
// Sécurité PowerSync. Entrée de build dédiée (voir electron.vite.config.ts),
// jamais importée statiquement ailleurs : chargée dynamiquement via
// openWorker dans powersync/index.ts, qui transmet la clé via workerData.

// CONTOURNEMENT NON OFFICIEL — à retirer si une future version de
// @powersync/node corrige l'ordre décrit ci-dessous (vérifié sur
// @powersync/node@0.20.2, chemins relatifs à node_modules/@powersync/node) :
//
//   lib/db/BetterSqliteWorker.js:61-67 (openDatabase) :
//     61  export async function openDatabase(worker, options) {
//     62    const BetterSQLite3Database = await worker.loadBetterSqlite3();
//     63    const baseDB = new BetterSQLite3Database(options.path, { readonly: !options.isWriter });
//     64    baseDB.loadExtension(worker.extensionPath(), 'sqlite3_powersync_init');  // <- AVANT toute clé
//     65    const asyncDb = new BlockingAsyncDatabase(baseDB);
//     66    return asyncDb;
//     67  }
//
//   lib/db/WorkerConnectionPool.js:75-86 (openWorker, connexion writer) :
//     75  const database = (await comlink.open({ path: dbFilePath, isWriter, ... }));
//     80  if (isWriter) {
//     81    await database.executeRaw("SELECT powersync_update_hooks('install');", []);  // <- AVANT initializeConnection
//     82  }
//     84  if (this.options.initializeConnection) {
//     85    await this.options.initializeConnection(connection, isWriter);  // <- notre pragma key, ICI SEULEMENT
//     86  }
//
// Sur une base chiffrée (SQLite3MultipleCiphers), loadExtension() et
// powersync_update_hooks('install') s'exécutent tous les deux AVANT que
// notre hook initializeConnection n'ait la moindre chance de poser
// `pragma key`. Constaté et reproduit (avec le logger officiel du SDK en
// LogLevels.trace, qui ne révèle rien de plus) : le worker reste bloqué
// indéfiniment, sans erreur ni log, et la base locale ne reçoit jamais son
// schéma (voir docs/backlog.md, chantier PowerSync). Recherche dans la doc
// officielle et les issues GitHub powersync-js : le pattern documenté
// (openWorker + initializeConnection) est identique au nôtre et ne couvre
// pas ce cas — aucun contournement officiel trouvé.
//
// Solution : poser la clé dans le CONSTRUCTEUR de la classe Database
// elle-même, avant que BetterSqliteWorker.js n'ait la moindre chance
// d'appeler loadExtension() ou powersync_update_hooks('install').
const cleRecue = (workerData as { encryptionKey?: string } | null)?.encryptionKey;
if (!cleRecue) {
  throw new Error(
    "Clé de chiffrement PowerSync absente du workerData — le worker refuse d'ouvrir la base plutôt que de risquer un pragma key silencieusement ignoré ou une base ouverte non chiffrée."
  );
}
const cleChiffrement: string = cleRecue;

// Ne peut pas être une classe TypeScript `extends Database` : le shim
// better-sqlite3-multiple-ciphers.d.ts type le module en `unknown` (bug de
// résolution des types de ce package sous moduleResolution "Bundler", voir
// ce fichier), donc pas de prototype exploitable pour un `extends`. Une
// fonction constructeur classique, qui retourne explicitement l'instance
// après lui avoir posé sa clé, produit exactement le même résultat au
// runtime (`new` sur une fonction qui `return` un objet retourne cet objet).
function ouvrirBaseChiffree(...args: unknown[]): unknown {
  const ConstructeurDatabase = Database as unknown as new (...a: unknown[]) => DatabaseAvecPragma;
  const instance = new ConstructeurDatabase(...args);
  const cleEchappee = cleChiffrement.replaceAll("'", "''");
  instance.pragma(`key = '${cleEchappee}'`);
  return instance;
}

startPowerSyncWorker({ loadBetterSqlite3: async () => ouvrirBaseChiffree });
