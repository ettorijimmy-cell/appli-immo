import {
  alertes,
  appartements,
  baux,
  bien,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  equipements,
  paiements,
  scis
} from "db";
import { and, eq } from "drizzle-orm";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

async function creerSiAbsente(
  db: ReturnType<typeof createDbClient>,
  type: (typeof alertes.$inferInsert)["type"],
  entiteId: string,
  valeurs: Omit<typeof alertes.$inferInsert, "type" | "entiteId">
): Promise<void> {
  const [existante] = await db
    .select()
    .from(alertes)
    .where(and(eq(alertes.type, type), eq(alertes.entiteId, entiteId)))
    .limit(1);
  if (existante) {
    console.log(`Alerte "${type}" déjà présente (${existante.id}) pour entite_id=${entiteId} — rien à créer.`);
    return;
  }

  const [alerte] = await db
    .insert(alertes)
    .values({ type, entiteId, ...valeurs })
    .returning();
  if (!alerte) {
    throw new Error(`Échec de la création de l'alerte de test "${type}"`);
  }
  console.log(
    `Alerte "${alerte.type}" (${alerte.id}) créée — entite_id=${alerte.entiteId}, derniere_condition_vraie=${alerte.derniereConditionVraie}.`
  );
}

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

    const [bienTrouve] = await db.select().from(bien).where(eq(bien.sciId, sci.id)).limit(1);
    if (!bienTrouve) {
      console.error(`Aucun bien pour "${sci.nom}" — lancer seed:test-bien-appartement d'abord.`);
      process.exitCode = 1;
      return;
    }

    const [appartement] = await db
      .select()
      .from(appartements)
      .where(eq(appartements.bienId, bienTrouve.id))
      .limit(1);
    if (!appartement) {
      console.error(`Aucun appartement pour le bien "${bienTrouve.nom}" — lancer seed:test-bien-appartement d'abord.`);
      process.exitCode = 1;
      return;
    }

    const [bail] = await db.select().from(baux).where(eq(baux.appartementId, appartement.id)).limit(1);
    if (!bail) {
      console.error(`Aucun bail pour l'appartement "${appartement.numero}" — lancer seed:test-locataire-bail d'abord.`);
      process.exitCode = 1;
      return;
    }

    const [paiement] = await db.select().from(paiements).where(eq(paiements.bailId, bail.id)).limit(1);
    if (!paiement) {
      console.error(`Aucun paiement pour le bail ${bail.id} — lancer seed:test-finance d'abord.`);
      process.exitCode = 1;
      return;
    }

    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.entiteId, appartement.id))
      .limit(1);
    if (!document) {
      console.error(`Aucun document pour l'appartement "${appartement.numero}" — lancer seed:test-document-diagnostic d'abord.`);
      process.exitCode = 1;
      return;
    }

    const [equipement] = await db
      .select()
      .from(equipements)
      .where(eq(equipements.appartementId, appartement.id))
      .limit(1);
    if (!equipement) {
      console.error(`Aucun équipement pour l'appartement "${appartement.numero}" — lancer seed:test-equipement d'abord.`);
      process.exitCode = 1;
      return;
    }

    await creerSiAbsente(db, "bail_fin_proche", bail.id, {
      statut: "active",
      message: "Le bail se termine dans moins de 60 jours.",
      dateReference: "2026-10-15"
    });

    await creerSiAbsente(db, "impaye", paiement.id, {
      statut: "active",
      message: "Le loyer du mois n'a pas été réglé à l'échéance.",
      dateReference: "2026-01-05"
    });

    // derniere_condition_vraie forcé explicitement à false (valeur
    // non-défaut) — sert à vérifier que son exclusion du Sync Stream
    // documents/alertes est réelle, pas seulement masquée par la valeur
    // par défaut 'true' des autres lignes (voir docs/backlog.md, chantier
    // PowerSync).
    await creerSiAbsente(db, "document_expire", document.id, {
      statut: "active",
      message: "Un document arrive à expiration.",
      dateReference: "2026-09-01",
      derniereConditionVraie: false
    });

    await creerSiAbsente(db, "entretien_equipement", equipement.id, {
      statut: "active",
      message: "L'entretien de cet équipement est dû.",
      dateReference: "2026-06-01"
    });
  } finally {
    await db.$client.end();
  }
}

void main();
