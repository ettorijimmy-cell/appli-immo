import type { PowerSyncBackendConnector, PowerSyncCredentials } from "@powersync/node";
import { getStoredCredentials } from "./credentials-store";

export class AppConnector implements PowerSyncBackendConnector {
  fetchCredentials(): Promise<PowerSyncCredentials | null> {
    return Promise.resolve(getStoredCredentials());
  }

  // Intégration en lecture seule pour ce premier test (voir docs/backlog.md,
  // chantier PowerSync) — les écritures continuent de passer par l'API REST
  // existante, aucune mutation locale n'est censée exister à ce stade.
  // Échec bruyant plutôt qu'un no-op silencieux si une transaction apparaît
  // quand même : un no-op perdrait silencieusement la donnée locale
  // correspondante (jamais renvoyée au backend), à traiter explicitement le
  // jour où l'écriture locale sera implémentée, pas maintenant.
  uploadData: PowerSyncBackendConnector["uploadData"] = async (database) => {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) {
      return;
    }
    throw new Error(
      "uploadData() non implémentée : aucune écriture locale n'est censée exister à ce stade (intégration en lecture seule, voir docs/backlog.md, chantier PowerSync). Une transaction en attente signale un bug."
    );
  };
}
