// Backfill Phase 1 (expand) du chantier "versements & remboursements"
// (docs/data-dictionary.md, section "versements & remboursements —
// décisions de conception"). Purement additif : insère un `versement` par
// paiement déjà réglé (montant_paye/mode/date_paiement/
// reference_rapprochement -> une ligne versements), ne touche à aucune
// colonne existante de `paiements`. Idempotent : un paiement qui a déjà
// un versement (backfillé ou non) est ignoré, donc rejouable sans risque
// de doublon SUR CETTE MÊME BASE.
//
// À USAGE UNIQUE, PAS UN OUTIL GÉNÉRAL COMME seed-user.ts :
// - N'a de sens que pour migrer des lignes `paiements` déjà existantes,
//   créées sous l'ancien modèle (un seul montant_paye par paiement). Une
//   base provisionnée après la fin de ce chantier (Scaleway, ou toute
//   nouvelle base créée après la Phase 3) n'aura jamais connu cet ancien
//   modèle : rien à y backfiller, ce script n'a alors plus de raison
//   d'être exécuté.
// - Cassé par construction après la Phase 3 (migration "contract" qui
//   supprime montant_paye/mode/date_paiement/reference_rapprochement de
//   `paiements`) : ce script lit directement ces colonnes, il ne
//   compilera même plus une fois qu'elles auront disparu du schéma.
// - À conserver comme trace historique de cette migration (jamais de
//   suppression physique, cohérent avec CLAUDE.md), mais jamais à relancer
//   sur une autre base en pensant qu'il s'agit d'un outil réutilisable.
import { createDbClient, DEFAULT_DEV_DATABASE_URL, paiements, versements } from "db";
import { isNotNull, sql } from "drizzle-orm";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL;
  const db = createDbClient(databaseUrl);

  try {
    const paiementsRegles = await db.select().from(paiements).where(isNotNull(paiements.montantPaye));

    console.log(`Paiements déjà réglés (montant_paye non nul) : ${paiementsRegles.length}`);

    let crees = 0;
    let ignores = 0;
    const anomalies: string[] = [];

    for (const paiement of paiementsRegles) {
      const [versementExistant] = await db
        .select()
        .from(versements)
        .where(sql`${versements.paiementId} = ${paiement.id}`)
        .limit(1);
      if (versementExistant) {
        ignores++;
        continue;
      }

      // Garde redondante avec le WHERE isNotNull(montantPaye) ci-dessus
      // (le SQL le garantit déjà au runtime), mais nécessaire pour que
      // TypeScript resserre le type string|null en string avant l'insert.
      if (!paiement.montantPaye) {
        continue;
      }
      if (!paiement.datePaiement) {
        anomalies.push(
          `Paiement ${paiement.id} : montant_paye non nul (${paiement.montantPaye}) mais date_paiement nul — backfill impossible sans date, IGNORÉ.`
        );
        continue;
      }
      if (!paiement.mode) {
        anomalies.push(
          `Paiement ${paiement.id} : montant_paye non nul (${paiement.montantPaye}) mais mode nul — backfill impossible sans mode, IGNORÉ.`
        );
        continue;
      }

      // created_at/updated_at figés à updated_at du paiement d'origine
      // (meilleure approximation disponible de "quand ce versement a été
      // saisi" — aucun historique plus précis n'existait avant ce chantier)
      // plutôt que la valeur par défaut now().
      await db.insert(versements).values({
        paiementId: paiement.id,
        montant: paiement.montantPaye,
        dateVersement: paiement.datePaiement,
        mode: paiement.mode,
        referenceRapprochement: paiement.referenceRapprochement ?? undefined,
        createdAt: paiement.updatedAt,
        updatedAt: paiement.updatedAt,
        updatedBy: paiement.updatedBy ?? undefined
      });
      crees++;
    }

    console.log(`Versements créés : ${crees}`);
    console.log(`Paiements déjà pourvus d'un versement (ignorés) : ${ignores}`);
    if (anomalies.length > 0) {
      console.log(`\nAnomalies (${anomalies.length}) :`);
      for (const anomalie of anomalies) {
        console.log(`  - ${anomalie}`);
      }
    }

    // Vérification : un seul versement par paiement backfillé, montant
    // identique au montant_paye d'origine.
    const verification = await db.execute(sql`
      SELECT p.id AS paiement_id, p.montant_paye, COUNT(v.id) AS nb_versements, COALESCE(SUM(v.montant), 0) AS somme_versements
      FROM paiements p
      LEFT JOIN versements v ON v.paiement_id = p.id
      WHERE p.montant_paye IS NOT NULL
      GROUP BY p.id, p.montant_paye
      HAVING COUNT(v.id) != 1 OR COALESCE(SUM(v.montant), 0) != p.montant_paye
    `);

    if (verification.length === 0) {
      console.log("\nVérification OK : chaque paiement réglé a exactement un versement, montant identique.");
    } else {
      console.log(`\nVérification EN ÉCHEC : ${verification.length} paiement(s) incohérent(s) :`);
      for (const ligne of verification) {
        console.log(`  - ${JSON.stringify(ligne)}`);
      }
    }
  } finally {
    await db.$client.end();
  }
}

void main();
