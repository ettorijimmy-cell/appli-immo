// Lance la suite d'intégration backend contre un Postgres jetable (port
// 5434, docker-compose.test.yml), jamais contre la base de dev (5433,
// docker-compose.yml) — voir CLAUDE.md, section Commandes. Garantit une
// base vide à chaque lancement (down -v avant ET après), toujours dans un
// finally pour que l'échec des tests ne laisse jamais le conteneur tourner.
//
// `pnpm` passe par cmd.exe sous Windows (pnpm.cmd) : spawnSync a besoin de
// shell: true pour le résoudre, donc jamais la syntaxe shell VAR=valeur —
// les variables d'environnement sont injectées via l'option `env` de
// spawnSync (API Node, portable), jamais par une commande shell.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const composeFile = join(rootDir, "docker-compose.test.yml");
const tmpDir = join(rootDir, "tmp");

// Identifiants factices repris de .github/workflows/ci.yml — jamais un
// vrai secret, jamais la base de dev. VITE_API_URL n'est utile qu'à
// `pnpm build` (garde-fou electron.vite.config.ts), pas à test:integration,
// mais repris ici par cohérence avec les variables de ci.yml.
const DATABASE_URL = "postgres://postgres:postgres@localhost:5434/appli_immo_test";
const VITE_API_URL = "https://api.appli-immo.example.com";

// Garde-fou : ce script ne doit jamais pouvoir agir sur autre chose que le
// Postgres jetable 5434, même après une modification future de ce fichier
// qui oublierait de mettre host/port à jour en cohérence avec
// docker-compose.test.yml.
function assertUrlEstLocalhost5434(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== "localhost" || parsed.port !== "5434") {
    throw new Error(
      `DATABASE_URL doit pointer sur localhost:5434 (Postgres jetable), pas ${parsed.hostname}:${parsed.port}. ` +
        "Abandon avant toute action sur la base — ne touche jamais à la base de dev (5433)."
    );
  }
}
assertUrlEstLocalhost5434(DATABASE_URL);

const envEtapes = { ...process.env, DATABASE_URL, VITE_API_URL };

function executer(commande, args, { cwd = rootDir, env = process.env } = {}) {
  console.log(`$ ${commande} ${args.join(" ")}`);
  const resultat = spawnSync(commande, args, { cwd, env, stdio: "inherit", shell: true });
  if (resultat.error) {
    throw resultat.error;
  }
  return resultat.status ?? 1;
}

function arreterConteneur() {
  // --- -v : best-effort, jamais bloquant (rien à détruire si le
  // conteneur n'a jamais démarré, ex. échec avant le `up`).
  executer("docker", ["compose", "-f", composeFile, "down", "-v"]);
}

// Sur échec, capture les logs Postgres AVANT le down -v (qui détruit le
// conteneur) — Postgres y écrit le DETAIL complet d'un deadlock (PID des
// processus, requêtes exactes, verrous en cause), que vitest ne remonte
// jamais dans son propre message d'erreur. tmp/ est ignoré par git
// (.gitignore: "tmp/*") — jamais versionné.
function capturerLogsPostgres() {
  const resultat = spawnSync("docker", ["compose", "-f", composeFile, "logs", "postgres-test"], {
    cwd: rootDir,
    shell: true,
    encoding: "utf8"
  });
  const sortie = (resultat.stdout ?? "") + (resultat.stderr ?? "");
  mkdirSync(tmpDir, { recursive: true });
  const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
  const fichierLog = join(tmpDir, `test-integration-postgres-${horodatage}.log`);
  writeFileSync(fichierLog, sortie);
  console.error(`Tests en échec — logs Postgres (conteneur jetable) enregistrés dans ${fichierLog}`);
}

let codeSortieTests = 1;
try {
  // Nettoyage préalable : si un lancement précédent a été interrompu
  // (Ctrl+C) sans passer par le finally, le volume peut encore exister —
  // jamais partir d'un état incertain.
  arreterConteneur();

  const codeUp = executer("docker", ["compose", "-f", composeFile, "up", "-d", "--wait"]);
  if (codeUp !== 0) {
    throw new Error(`docker compose up a échoué (code ${codeUp}).`);
  }

  const codeMigrate = executer("pnpm", ["--filter", "db", "db:migrate"], { env: envEtapes });
  if (codeMigrate !== 0) {
    throw new Error(`Migrations Drizzle échouées (code ${codeMigrate}).`);
  }

  const codeSeed = executer("pnpm", ["seed:inventaire-meuble"], { env: envEtapes });
  if (codeSeed !== 0) {
    throw new Error(`Seed inventaire meublé échoué (code ${codeSeed}).`);
  }

  codeSortieTests = executer("pnpm", ["--filter", "backend", "test:integration"], { env: envEtapes });
  if (codeSortieTests !== 0) {
    capturerLogsPostgres();
  }
} finally {
  arreterConteneur();
}

process.exit(codeSortieTests);
