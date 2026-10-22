import Database from "better-sqlite3-multiple-ciphers";
import { getPowerSyncExtensionFilename, startPowerSyncWorker } from "@powersync/node/worker.js";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
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

// Filet de sécurité pour toute exception qui échapperait au try/catch de
// ouvrirBaseChiffree ci-dessous — notamment un crash pendant le chargement
// du module lui-même, avant que startPowerSyncWorker n'ait fini d'installer
// le canal Comlink : dans ce cas le thread principal ne reçoit jamais de
// réponse et aucune exception ne remonte via Comlink, d'où l'intérêt des
// écouteurs "error"/"exit" posés côté main sur l'objet Worker (voir
// powersync/index.ts). N'affiche jamais que l'exception JS elle-même
// (error/reason) : ni la clé de chiffrement ni le jeton PowerSync ne
// transitent par ces variables.
process.on("uncaughtException", (erreur) => {
  console.error("[PowerSync worker] exception non interceptée dans le thread worker :", erreur);
  process.exit(1);
});
process.on("unhandledRejection", (raison) => {
  console.error("[PowerSync worker] rejet de promesse non intercepté dans le thread worker :", raison);
  process.exit(1);
});

// Chemin de la bibliothèque native powersync_x64.dll (ou .so/.dylib)
// chargée par loadExtension() dans BetterSqliteWorker.js:64. Le SDK calcule
// par défaut ce chemin via `new URL('../' + fichier, import.meta.url)`
// relatif à son propre fichier SqliteWorker.js — correct en dev, mais en
// appli packagée ce chemin tombe à l'intérieur de app.asar
// (resources/app.asar/node_modules/@powersync/node/lib/powersync_x64.dll).
// loadExtension() appelle en interne LoadLibrary (Windows) / dlopen
// (Linux/macOS), des appels système sur le fichier réel — ils ne passent
// jamais par le système de fichiers virtuel qu'Electron superpose à
// app.asar pour fs/require, et échouent avec "Le module spécifié est
// introuvable" (erreur Windows 126) sur un chemin à l'intérieur de
// l'archive. Reproduit et confirmé par les diagnostics ci-dessus
// (message exact : "SqliteError: Le module spécifié est introuvable",
// pile dans BetterSqliteWorker.js:64).
//
// `extensionPath` est une option officielle et typée de
// startPowerSyncWorker (PowerSyncWorkerOptions, lib/db/SqliteWorker.d.ts) —
// utilisée ici plutôt que de dupliquer le binaire via asarUnpack sur tout
// le paquet @powersync/node (inutile : seul ce .dll a besoin d'être lu par
// un appel système, pas le reste du code JS du SDK) ou d'intercepter
// loadExtension après construction de l'instance (plus fragile, dépendrait
// de la forme exacte de l'instance retournée par le SDK).
//
// require.resolve() passe par le résolveur de modules Node (lui bien patché
// par Electron pour lire dans l'archive) et retrouve donc le même chemin
// virtuel que import.meta.url aurait donné. Electron place systématiquement
// un miroir réel sur disque de chaque fichier concerné par asarUnpack sous
// app.asar.unpacked/, avec la même arborescence relative (confirmé :
// electron-builder.yml unpack bien powersync_x64.dll) — il suffit donc de
// rediriger le segment "app.asar" vers "app.asar.unpacked" dans le chemin
// obtenu pour atteindre l'emplacement réel du binaire. Sans effet en dev :
// aucun "app.asar" n'apparaît alors dans le chemin.
function cheminExtensionPowerSync(): string {
  const requireDepuisCeWorker = createRequire(__filename);
  const cheminPackageJson = requireDepuisCeWorker.resolve("@powersync/node/package.json");
  const cheminDansArchive = join(dirname(cheminPackageJson), "lib", getPowerSyncExtensionFilename());

  const segmentArchive = `app.asar${sep}`;
  const segmentDecompresse = `app.asar.unpacked${sep}`;
  if (cheminDansArchive.includes(segmentDecompresse)) {
    return cheminDansArchive;
  }
  if (cheminDansArchive.includes(segmentArchive)) {
    return cheminDansArchive.replace(segmentArchive, segmentDecompresse);
  }
  return cheminDansArchive;
}

// Ne peut pas être une classe TypeScript `extends Database` : le shim
// better-sqlite3-multiple-ciphers.d.ts type le module en `unknown` (bug de
// résolution des types de ce package sous moduleResolution "Bundler", voir
// ce fichier), donc pas de prototype exploitable pour un `extends`. Une
// fonction constructeur classique, qui retourne explicitement l'instance
// après lui avoir posé sa clé, produit exactement le même résultat au
// runtime (`new` sur une fonction qui `return` un objet retourne cet objet).
function ouvrirBaseChiffree(...args: unknown[]): unknown {
  // Couvre l'ouverture du fichier et la pose de la clé. Ne couvre pas
  // loadExtension('sqlite3_powersync_init'), qui a lieu après, dans le SDK
  // (BetterSqliteWorker.js, hors de notre code) — une erreur à cette étape
  // remonte via le mécanisme RPC Comlink normal du SDK, pas par ce catch.
  try {
    const ConstructeurDatabase = Database as unknown as new (...a: unknown[]) => DatabaseAvecPragma;
    const instance = new ConstructeurDatabase(...args);
    const cleEchappee = cleChiffrement.replaceAll("'", "''");
    instance.pragma(`key = '${cleEchappee}'`);
    return instance;
  } catch (erreur) {
    console.error("[PowerSync worker] échec de l'ouverture de la base chiffrée :", erreur);
    throw erreur;
  }
}

startPowerSyncWorker({
  loadBetterSqlite3: async () => ouvrirBaseChiffree,
  extensionPath: cheminExtensionPowerSync
});
