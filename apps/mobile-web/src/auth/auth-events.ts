// Constantes et bus d'évènements partagés entre AuthContext et
// authenticated-fetch — dans un module séparé pour éviter un import
// circulaire entre les deux (l'un gère l'état de session, l'autre
// déclenche sa purge sur 401). Même mécanisme que apps/desktop.
export const TOKEN_STORAGE_KEY = "appli-immo-mobile:access-token";
export const UNAUTHORIZED_EVENT = "appli-immo:unauthorized";
export const authEvents = new EventTarget();
