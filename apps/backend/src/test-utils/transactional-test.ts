import type { Database } from "db";

// Sentinelle utilisée pour forcer un ROLLBACK depuis l'intérieur du callback
// `db.transaction(...)` sans faire remonter une vraie erreur au test.
class RollbackSignal extends Error {}

// Chaque test d'intégration tourne dans sa propre transaction, annulée dans
// afterEach — jamais de DELETE manuel après coup. Plus fiable qu'un nettoyage
// explicite : même si un test plante en cours de route, le ROLLBACK annule
// tout ce qu'il a écrit (setup compris, puisque le setup tourne aussi dans la
// transaction). `rootDb` sert uniquement à ouvrir la transaction ; il doit
// rester ouvert pour toute la durée du fichier de test (fermé dans afterAll).
export function createTransactionalTestHooks(rootDb: Database): {
  begin: () => Promise<Database>;
  rollback: () => Promise<void>;
} {
  let releaseTransaction: () => void = () => {};
  let transactionSettled: Promise<void> = Promise.resolve();

  async function begin(): Promise<Database> {
    let markReady: (tx: Database) => void;
    const ready = new Promise<Database>((resolve) => {
      markReady = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });

    transactionSettled = rootDb
      .transaction(async (tx) => {
        markReady(tx as unknown as Database);
        await release;
        throw new RollbackSignal();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RollbackSignal)) {
          throw error;
        }
      });

    return ready;
  }

  async function rollback(): Promise<void> {
    releaseTransaction();
    await transactionSettled;
  }

  return { begin, rollback };
}
