import { appartements, bien, createDbClient, DEFAULT_DEV_DATABASE_URL, equipements, scis } from "db";
import { eq } from "drizzle-orm";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
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

    const [equipementExistant] = await db
      .select()
      .from(equipements)
      .where(eq(equipements.appartementId, appartement.id))
      .limit(1);
    if (equipementExistant) {
      console.log(`Équipement "${equipementExistant.type}" (${equipementExistant.id}) déjà présent pour "${appartement.numero}" — rien à créer.`);
      return;
    }

    const [equipement] = await db
      .insert(equipements)
      .values({
        appartementId: appartement.id,
        type: "chaudiere",
        dateDernierEntretien: "2026-06-01",
        intervalleEntretienMois: 12
      })
      .returning();
    if (!equipement) {
      throw new Error("Échec de la création de l'équipement de test");
    }

    console.log(`Équipement "${equipement.type}" (${equipement.id}) créé sous l'appartement "${appartement.numero}" (${appartement.id}).`);
  } finally {
    await db.$client.end();
  }
}

void main();
