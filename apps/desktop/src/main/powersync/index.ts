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

// Le worker de base de données (database.worker.ts) communique avec ce
// thread principal par un canal Comlink au-dessus de postMessage : si le
// worker se bloque avant de répondre (ex. échec de chargement d'une
// bibliothèque native jamais relayé par le SDK), l'appelant reste en
// attente indéfiniment, sans la moindre trace dans les logs. Cette
// enveloppe borne toute opération PowerSync à ce délai et rejette avec un
// message explicite plutôt que de laisser l'appelant bloqué en silence —
// elle n'annule pas l'opération d'origine (qui continue en arrière-plan),
// elle rend seulement un blocage visible.
const DELAI_SURVEILLANCE_MS = 30_000;

function avecDelaiSurveillance<T>(promesse: Promise<T>, etiquette: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const minuteur = setTimeout(() => {
      reject(
        new Error(
          `[PowerSync] ${etiquette} n'a pas abouti après ${DELAI_SURVEILLANCE_MS}ms — ` +
            "le worker de base de données ne répond probablement pas."
        )
      );
    }, DELAI_SURVEILLANCE_MS);
    promesse.then(
      (valeur) => {
        clearTimeout(minuteur);
        resolve(valeur);
      },
      (erreur) => {
        clearTimeout(minuteur);
        reject(erreur);
      }
    );
  });
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
      openWorker: (_filename, options) => {
        const worker = new Worker(join(__dirname, "powersync-worker.js"), {
          ...options,
          workerData: { encryptionKey: cle }
        });
        // Le SDK installe son propre écouteur "error" sur ce Worker, mais
        // seulement APRÈS l'avoir créé (WorkerConnectionPool.js, openWorker)
        // — ceux-ci sont posés immédiatement pour ne rater aucun événement,
        // y compris un crash survenant avant que le SDK ait fini sa propre
        // initialisation. Jamais de clé ni de jeton dans ces logs :
        // "error"/"exit"/"messageerror" ne transportent aucune donnée
        // issue de workerData, seulement l'erreur JS ou le code de sortie.
        worker.on("error", (erreur) => {
          console.error("[PowerSync worker] erreur non interceptée dans le worker :", erreur);
        });
        worker.on("exit", (code) => {
          if (code !== 0) {
            console.error(`[PowerSync worker] le worker s'est arrêté avec le code ${code}`);
          }
        });
        worker.on("messageerror", (erreur) => {
          console.error("[PowerSync worker] message illisible reçu du worker :", erreur);
        });
        return worker;
      },
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
  // Isole "la base locale ne s'ouvre pas" (worker bloqué) de "la connexion
  // au service PowerSync échoue" (réseau/jeton) : deux points de blocage
  // distincts possibles, donc deux messages distincts si l'un des deux
  // dépasse le délai de surveillance.
  await avecDelaiSurveillance(database.waitForReady(), "database.waitForReady() (ouverture de la base locale)");
  if (!connected) {
    await avecDelaiSurveillance(
      database.connect(new AppConnector()),
      "database.connect() (connexion au service PowerSync)"
    );
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
