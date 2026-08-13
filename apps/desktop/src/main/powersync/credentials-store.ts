export interface StoredPowerSyncCredentials {
  token: string;
  endpoint: string;
}

// Pont entre l'IPC (renderer, qui obtient le jeton via GET /powersync/token,
// authentifié avec le JWT applicatif) et le connecteur PowerSync (processus
// principal). Pas de rafraîchissement automatique pour ce premier test
// minimal (jeton valide 60 min, largement suffisant pour la durée d'une
// session de test) — à traiter avec l'extension par domaine (docs/backlog.md).
let current: StoredPowerSyncCredentials | null = null;

export function setStoredCredentials(credentials: StoredPowerSyncCredentials | null): void {
  current = credentials;
}

export function getStoredCredentials(): StoredPowerSyncCredentials | null {
  return current;
}
