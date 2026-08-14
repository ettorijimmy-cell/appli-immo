import { randomBytes } from "node:crypto";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, safeStorage } from "electron";

const DB_FILENAME = "powersync.db";
const KEY_FILENAME = "powersync-key.enc";
// Marqueur à usage unique : distingue le premier lancement de cette
// fonctionnalité (où l'absence de clé est normale — aucune n'a jamais
// existé, la base locale éventuellement présente ne contient que des
// données de test, donc une purge silencieuse est sûre) du régime
// permanent ensuite (où l'absence de clé est une anomalie qui doit faire
// échouer le démarrage bruyamment, jamais régénérer une clé en silence).
// Voir docs/backlog.md, chantier PowerSync — chiffrement local.
const MIGRATION_MARKER_FILENAME = "powersync-migration-v1-done";

function cheminsLocaux() {
  const userDataDir = app.getPath("userData");
  return {
    dbFile: join(userDataDir, DB_FILENAME),
    keyFile: join(userDataDir, KEY_FILENAME),
    migrationMarker: join(userDataDir, MIGRATION_MARKER_FILENAME)
  };
}

async function existe(chemin: string): Promise<boolean> {
  try {
    await access(chemin);
    return true;
  } catch {
    return false;
  }
}

async function purgerBaseNonChiffree(dbFile: string): Promise<void> {
  await Promise.all(["", "-wal", "-shm"].map((suffixe) => rm(`${dbFile}${suffixe}`, { force: true })));
}

async function genererEtStockerNouvelleCle(keyFile: string): Promise<string> {
  const cle = randomBytes(32).toString("base64");
  await writeFile(keyFile, safeStorage.encryptString(cle));
  return cle;
}

/**
 * Résout la clé de chiffrement de la base locale PowerSync, à appeler une
 * seule fois au démarrage (avant toute connexion PowerSync ou création de
 * fenêtre) — voir main/index.ts. Ne retourne jamais silencieusement : soit
 * une clé valide, soit une exception qui doit interrompre le démarrage.
 */
export async function initializePowerSyncEncryption(): Promise<string> {
  // Même principe que ENCRYPTION_KEY/JWT_SECRET côté backend (voir
  // docs/error-log.md) : échec bruyant plutôt qu'un repli silencieux vers
  // du non chiffré si le mécanisme système n'est pas disponible.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "Le chiffrement système (safeStorage) n'est pas disponible sur cette machine — impossible de protéger la base locale PowerSync. L'application ne peut pas démarrer sans ce mécanisme."
    );
  }

  const { dbFile, keyFile, migrationMarker } = cheminsLocaux();

  if (!(await existe(migrationMarker))) {
    await purgerBaseNonChiffree(dbFile);
    const cle = await genererEtStockerNouvelleCle(keyFile);
    await writeFile(migrationMarker, new Date().toISOString());
    return cle;
  }

  if (!(await existe(keyFile))) {
    throw new Error(
      "Clé de chiffrement PowerSync introuvable alors que la migration initiale est déjà effectuée sur cet appareil — l'application refuse de régénérer une clé silencieusement (perte de données locales potentielle). Voir docs/backlog.md, chantier PowerSync."
    );
  }

  const chiffre = await readFile(keyFile);
  try {
    return safeStorage.decryptString(chiffre);
  } catch (error) {
    throw new Error(
      "Impossible de déchiffrer la clé PowerSync stockée (trousseau système modifié ou fichier corrompu).",
      { cause: error }
    );
  }
}
