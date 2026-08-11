import { describe, expect, it } from "vitest";
import type { Database } from "db";
import { createTransactionalTestHooks } from "./transactional-test";

// Reproduit exactement le scénario vécu (voir docs/error-log.md,
// [2026-08-11]) : rootDb.transaction(...) rejette AVANT d'appeler son
// callback (donc avant markReady) — ex. connexion Postgres impossible à
// établir. Avant le correctif, begin() restait bloqué pour toujours au
// lieu de faire remonter cette erreur.
function fauxRootDbEchecConnexion(erreur: Error): Database {
  return {
    transaction: () => Promise.reject(erreur)
  } as unknown as Database;
}

describe("createTransactionalTestHooks", () => {
  it("begin() rejette avec la vraie erreur si la transaction échoue avant d'appeler son callback (ne bloque jamais)", async () => {
    const erreurReelle = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    const { begin, rollback } = createTransactionalTestHooks(fauxRootDbEchecConnexion(erreurReelle));

    await expect(begin()).rejects.toThrow("connect ECONNREFUSED 127.0.0.1:5432");
    // afterEach() appelle rollback() même quand beforeEach a jeté avant
    // d'y arriver (voir les 12 fichiers de test d'intégration) — même
    // erreur réelle exposée une seconde fois côté cleanup, sans rejet
    // non intercepté.
    await expect(rollback()).rejects.toThrow("connect ECONNREFUSED 127.0.0.1:5432");
  });

  it("begin() résout normalement quand la transaction démarre avec succès", async () => {
    const fauxTx = {} as Database;
    const rootDb = {
      transaction: async (callback: (tx: Database) => Promise<void>) => {
        await callback(fauxTx);
      }
    } as unknown as Database;

    const { begin, rollback } = createTransactionalTestHooks(rootDb);
    const db = await begin();
    expect(db).toBe(fauxTx);

    await rollback();
  });
});
