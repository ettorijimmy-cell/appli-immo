// Résolution pure de la configuration Gotenberg (chantier PDF étape 4,
// 2026-10-27) — même principe que mobile-web-basic-auth.middleware.ts
// (lireConfigVerrouDepuisEnv) : une fonction pure, testable sans Nest ni
// réseau, qui décide seule si la conversion PDF est disponible.
export interface GotenbergConfig {
  url: string;
  basicAuthUsername: string | undefined;
  basicAuthPassword: string | undefined;
  timeoutMs: number;
}

// "absente" : GOTENBERG_URL non renseignée. "identifiants_partiels" : URL
// présente mais un seul des deux identifiants Basic Auth renseigné — les
// deux cas sont traités de façon identique par GotenbergService (jamais
// une variable requise au boot, conversion PDF simplement indisponible),
// mais avec un avertissement distinct pour chacun, voir son constructeur.
export type ResultatConfigGotenberg =
  | { statut: "absente" }
  | { statut: "identifiants_partiels" }
  | { statut: "ok"; config: GotenbergConfig };

// Généreux par défaut : couvre le réveil d'un conteneur Serverless
// Scaleway scale-to-zero (cold start du conteneur lui-même, puis premier
// lancement LibreOffice dans l'image Gotenberg) — voir docs/backlog.md.
const TIMEOUT_MS_DEFAUT = 60_000;

export function resoudreConfigGotenberg(lire: (cle: string) => string | undefined): ResultatConfigGotenberg {
  const url = lire("GOTENBERG_URL");
  if (!url) {
    return { statut: "absente" };
  }

  const basicAuthUsername = lire("GOTENBERG_BASIC_AUTH_USERNAME");
  const basicAuthPassword = lire("GOTENBERG_BASIC_AUTH_PASSWORD");
  // Les deux ensemble, ou aucun des deux — jamais un seul : un identifiant
  // renseigné sans l'autre est presque toujours un oubli de configuration
  // (secret non copié, variable mal nommée dans la console Scaleway),
  // jamais un choix délibéré de n'en fournir qu'un.
  if (Boolean(basicAuthUsername) !== Boolean(basicAuthPassword)) {
    return { statut: "identifiants_partiels" };
  }

  const timeoutBrut = lire("GOTENBERG_TIMEOUT_MS");
  const timeoutParse = timeoutBrut ? Number(timeoutBrut) : NaN;
  const timeoutMs = Number.isFinite(timeoutParse) && timeoutParse > 0 ? timeoutParse : TIMEOUT_MS_DEFAUT;

  return {
    statut: "ok",
    config: { url, basicAuthUsername, basicAuthPassword, timeoutMs }
  };
}
