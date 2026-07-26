// Constantes et bus d'évènements partagés entre AuthContext et
// authenticated-fetch — dans un module séparé pour éviter un import
// circulaire entre les deux (l'un gère l'état de session, l'autre
// déclenche sa purge sur 401).
//
// EventTarget (pas window.dispatchEvent) : disponible nativement en Node
// comme dans le renderer Electron, donc testable sans environnement DOM
// (jsdom/happy-dom).
export const TOKEN_STORAGE_KEY = "appli-immo:access-token";
export const UNAUTHORIZED_EVENT = "appli-immo:unauthorized";
export const authEvents = new EventTarget();
