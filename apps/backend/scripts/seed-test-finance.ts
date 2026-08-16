import {
  appartements,
  baux,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  immeubles,
  paiements,
  remboursements,
  scis,
  versements
} from "db";
import { eq } from "drizzle-orm";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

// Marqueurs volontairement distinctifs (pas des valeurs plausibles) — sert
// à vérifier ensuite, par recherche littérale dans le fichier SQLite local,
// que reference_rapprochement/commentaire n'ont jamais quitté Postgres via
// les Sync Streams versements/remboursements (voir docs/backlog.md,
// chantier PowerSync).
const REFERENCE_RAPPROCHEMENT_MARQUEUR = "MARQUEUR-NE-DOIT-JAMAIS-SYNC-REFERENCE";
const COMMENTAIRE_MARQUEUR = "MARQUEUR-NE-DOIT-JAMAIS-SYNC-COMMENTAIRE";

async function main(): Promise<void> {
  const nomSci = parseArg("nom-sci") ?? "SCI Test PowerSync";

  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL;
  const db = createDbClient(databaseUrl);

  try {
    const [sci] = await db.select().from(scis).where(eq(scis.nom, nomSci)).limit(1);
    if (!sci) {
      console.error(`Aucune SCI nommée "${nomSci}" — lancer seed:test-sci d'abord.`);
      process.exitCode = 1;
      return;
    }

    const [immeuble] = await db.select().from(immeubles).where(eq(immeubles.sciId, sci.id)).limit(1);
    if (!immeuble) {
      console.error(`Aucun immeuble pour "${sci.nom}" — lancer seed:test-immeuble-appartement d'abord.`);
      process.exitCode = 1;
      return;
    }

    const [appartement] = await db
      .select()
      .from(appartements)
      .where(eq(appartements.immeubleId, immeuble.id))
      .limit(1);
    if (!appartement) {
      console.error(`Aucun appartement pour l'immeuble "${immeuble.nom}" — lancer seed:test-immeuble-appartement d'abord.`);
      process.exitCode = 1;
      return;
    }

    const [bail] = await db.select().from(baux).where(eq(baux.appartementId, appartement.id)).limit(1);
    if (!bail) {
      console.error(`Aucun bail pour l'appartement "${appartement.numero}" — lancer seed:test-locataire-bail d'abord.`);
      process.exitCode = 1;
      return;
    }

    const [paiementExistant] = await db.select().from(paiements).where(eq(paiements.bailId, bail.id)).limit(1);
    if (paiementExistant) {
      console.log(`Paiement déjà présent (${paiementExistant.id}) pour le bail ${bail.id} — rien à créer.`);
      return;
    }

    const [paiement] = await db
      .insert(paiements)
      .values({
        bailId: bail.id,
        type: "loyer",
        montant: "650.00",
        dateEcheance: "2026-01-05"
      })
      .returning();
    if (!paiement) {
      throw new Error("Échec de la création du paiement de test");
    }

    const [versement] = await db
      .insert(versements)
      .values({
        paiementId: paiement.id,
        montant: "650.00",
        dateVersement: "2026-01-05",
        mode: "virement",
        referenceRapprochement: REFERENCE_RAPPROCHEMENT_MARQUEUR
      })
      .returning();
    if (!versement) {
      throw new Error("Échec de la création du versement de test");
    }

    const [remboursement] = await db
      .insert(remboursements)
      .values({
        bailId: bail.id,
        paiementId: paiement.id,
        type: "depot_garantie",
        montantOrigine: "650.00",
        montantRembourse: "650.00",
        commentaire: COMMENTAIRE_MARQUEUR,
        dateRemboursement: "2026-01-06",
        mode: "virement"
      })
      .returning();
    if (!remboursement) {
      throw new Error("Échec de la création du remboursement de test");
    }

    console.log(`Paiement (${paiement.id}) créé sous le bail ${bail.id}.`);
    console.log(`Versement (${versement.id}) créé — reference_rapprochement="${REFERENCE_RAPPROCHEMENT_MARQUEUR}" (à vérifier absent de la sync).`);
    console.log(`Remboursement (${remboursement.id}) créé — commentaire="${COMMENTAIRE_MARQUEUR}" (à vérifier absent de la sync).`);
  } finally {
    await db.$client.end();
  }
}

void main();
