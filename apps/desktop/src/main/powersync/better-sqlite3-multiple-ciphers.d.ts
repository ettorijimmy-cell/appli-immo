// Le package publie un champ "types" legacy (index.d.ts) mais son "exports"
// ne déclare pas de condition "types" — sous moduleResolution "Bundler",
// TypeScript ignore le champ legacy et ne résout aucune déclaration (bug
// d'empaquetage upstream, pas une lacune de notre config). PowerSync
// lui-même type le retour de loadBetterSqlite3() en Promise<any> (voir
// @powersync/node/lib/db/SqliteWorker.d.ts) — pas besoin de plus de
// précision ici, seul le constructeur est utilisé, jamais son API.
declare module "better-sqlite3-multiple-ciphers" {
  const Database: new (...args: unknown[]) => unknown;
  export default Database;
}
