// Même mécanisme que apps/desktop/src/renderer/src/lib/api-config.ts :
// VITE_API_URL vient du .env partagé à la racine du monorepo. Le repli
// localhost ci-dessous n'est jamais atteint en build de production —
// vite.config.ts (requireApiUrlInProdPlugin) échoue bruyamment avant si la
// variable est absente. Hébergement final encore à trancher (sous-chemin
// du backend ou hébergement statique séparé, voir docs/backlog.md, module
// "État des lieux") — cette indirection évite d'avoir à toucher au code
// une fois la décision prise.
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
