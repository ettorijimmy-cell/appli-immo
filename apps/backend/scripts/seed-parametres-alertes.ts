import { createDbClient, DEFAULT_DEV_DATABASE_URL, parametresAlertes } from "db";
import { SEUILS_PAR_DEFAUT } from "../src/alertes/alertes-config.service";

// Peuple une fois, en série et hors transaction, les lignes par défaut de
// parametres_alertes. AlertesConfigService.creerAvecDefaut() les crée
// normalement à la volée au premier accès (INSERT ... ON CONFLICT DO
// NOTHING) — mais plusieurs fichiers d'intégration déclenchent ce premier
// accès en parallèle contre la même base jetable, chacun dans sa propre
// transaction ouverte longtemps. Un deadlock réel et reproductible en
// résulte (capturé le 2026-10-23, voir docs/backlog.md) : un test
// verrouille un type précis (ex. 'impaye', alertes.integration.spec.ts
// ligne 377) avant de lancer AlertesJobService, qui retraverse les 5
// types dans l'ordre fixe habituel — deux clés tenues en sens croisé par
// deux transactions concurrentes, deadlock garanti (pas un simple conflit
// sur une clé unique, qui ne fait qu'attendre, jamais de cycle).
//
// Ce seed, lancé une seule fois avant Vitest (test-integration-clean.mjs,
// .github/workflows/ci.yml), élimine la course à la racine : chaque test
// trouve ensuite la ligne déjà là et ne fait plus jamais d'INSERT.
//
// ON CONFLICT DO NOTHING (pas DO UPDATE) : si une ligne existe déjà avec
// une valeur différente de la valeur par défaut (seuil personnalisé par
// l'utilisateur via PATCH /alertes/config/:type), ce script ne doit
// jamais l'écraser — même principe que creerAvecDefaut().
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL;
  const db = createDbClient(databaseUrl);

  try {
    const types = Object.keys(SEUILS_PAR_DEFAUT) as (keyof typeof SEUILS_PAR_DEFAUT)[];
    for (const type of types) {
      const seuilJoursAvant = SEUILS_PAR_DEFAUT[type];
      if (seuilJoursAvant === undefined) {
        continue;
      }
      await db.insert(parametresAlertes).values({ type, seuilJoursAvant }).onConflictDoNothing();
    }
    console.log(`Paramètres d'alertes par défaut : ${types.length} types seedés.`);
  } finally {
    await db.$client.end();
  }
}

void main();
