// Sauvegarde locale de la base Postgres de dev (docker-compose.yml) vers
// backups/ (ignoré par git — voir CLAUDE.md, section Commandes).
// N'utilise aucune dépendance ajoutée : Node natif + le CLI docker déjà
// requis pour faire tourner le projet.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const backupsDir = join(rootDir, "backups");
mkdirSync(backupsDir, { recursive: true });

const now = new Date();
const pad = (value) => String(value).padStart(2, "0");
const timestamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const outputFile = join(backupsDir, `appli_immo_dev_${timestamp}.sql`);

console.log(`Sauvegarde de la base appli_immo_dev vers ${outputFile}...`);

const result = spawnSync(
  "docker",
  ["compose", "exec", "-T", "postgres", "pg_dump", "-U", "postgres", "-d", "appli_immo_dev"],
  { cwd: rootDir, stdio: ["ignore", "pipe", "inherit"] }
);

if (result.error) {
  console.error(`Échec du lancement de docker compose : ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`pg_dump a échoué (code de sortie ${result.status}). Le Postgres de dev tourne-t-il ? (docker compose up -d)`);
  process.exit(result.status ?? 1);
}
if (result.stdout.length === 0) {
  console.error("pg_dump n'a produit aucune sortie — sauvegarde interrompue, rien n'a été écrit.");
  process.exit(1);
}

writeFileSync(outputFile, result.stdout);
console.log(`Sauvegarde terminée : ${outputFile} (${result.stdout.length} octets)`);
