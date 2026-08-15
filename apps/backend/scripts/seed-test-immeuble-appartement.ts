import { appartements, createDbClient, DEFAULT_DEV_DATABASE_URL, immeubles, scis } from "db";
import { eq } from "drizzle-orm";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

// Marqueur volontairement distinctif (pas une valeur fiscale plausible) —
// sert à vérifier ensuite, par recherche littérale dans le fichier SQLite
// local, que identifiant_fiscal n'a jamais quitté Postgres via le Sync
// Stream appartements (voir docs/backlog.md, chantier PowerSync).
const IDENTIFIANT_FISCAL_MARQUEUR = "MARQUEUR-NE-DOIT-JAMAIS-SYNC-1234567890";

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

    const [immeubleExistant] = await db.select().from(immeubles).where(eq(immeubles.sciId, sci.id)).limit(1);
    if (immeubleExistant) {
      const [appartementExistant] = await db
        .select()
        .from(appartements)
        .where(eq(appartements.immeubleId, immeubleExistant.id))
        .limit(1);
      if (appartementExistant) {
        console.log(`Immeuble "${immeubleExistant.nom}" (${immeubleExistant.id}) et appartement "${appartementExistant.numero}" (${appartementExistant.id}) déjà présents pour "${sci.nom}" — rien à créer.`);
        return;
      }
    }

    const immeuble =
      immeubleExistant ??
      (
        await db
          .insert(immeubles)
          .values({
            sciId: sci.id,
            nom: "Immeuble Test PowerSync",
            adresse: "2 rue de Test",
            codePostal: "75001",
            ville: "Paris",
            typeHabitat: "collectif",
            regimeJuridique: "copropriete",
            anneeConstruction: 1980
          })
          .returning()
      )[0];
    if (!immeuble) {
      throw new Error("Échec de la création de l'immeuble de test");
    }

    const [appartement] = await db
      .insert(appartements)
      .values({
        immeubleId: immeuble.id,
        numero: "Test-1",
        type: "T2",
        surface: "45.50",
        loyerReference: "650.00",
        identifiantFiscal: IDENTIFIANT_FISCAL_MARQUEUR,
        nombrePiecesPrincipales: 2
      })
      .returning();
    if (!appartement) {
      throw new Error("Échec de la création de l'appartement de test");
    }

    console.log(`Immeuble "${immeuble.nom}" (${immeuble.id}) créé sous la SCI "${sci.nom}" (${sci.id}).`);
    console.log(`Appartement "${appartement.numero}" (${appartement.id}) créé sous cet immeuble.`);
    console.log(`identifiant_fiscal = "${IDENTIFIANT_FISCAL_MARQUEUR}" (à vérifier absent de la sync).`);
  } finally {
    await db.$client.end();
  }
}

void main();
