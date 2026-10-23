// Résolution de l'URL de base de l'API appelée par mobile-web.
//
// Par défaut en production (estProd=true) : chaîne vide, donc une URL
// relative — l'appli est hébergée sous /mobile/ sur le MÊME backend (voir
// docs/backlog.md, hébergement mobile-web), si bien que
// fetch(`${API_BASE_URL}/baux`) résout vers `/baux` à la racine de cette
// même origine, sans CORS. Réversibilité : si VITE_API_URL définit une URL
// complète (ex. hébergement séparé sur un conteneur dédié), elle est
// utilisée telle quelle — aucun autre changement de code nécessaire pour
// ce cas (voir docs/backlog.md pour le chemin de migration complet).
//
// En développement (estProd=false), repli inchangé sur localhost:3000
// (backend local) si VITE_API_URL n'est pas défini — même mécanisme
// qu'avant ce changement.
export function resoudreApiBaseUrl(envApiUrl: string | undefined, estProd: boolean): string {
  if (envApiUrl) {
    return envApiUrl;
  }
  return estProd ? "" : "http://localhost:3000";
}

export const API_BASE_URL = resoudreApiBaseUrl(import.meta.env.VITE_API_URL, import.meta.env.PROD);
