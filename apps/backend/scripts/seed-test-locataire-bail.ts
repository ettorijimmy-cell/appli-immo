import {
  appartements,
  bailLocataires,
  baux,
  bien,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  garants,
  locataires,
  scis
} from "db";
import { eq } from "drizzle-orm";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

// Marqueurs volontairement distinctifs (pas des valeurs plausibles) — sert
// à vérifier ensuite, par recherche littérale dans le fichier SQLite local,
// que profession/revenus n'ont jamais quitté Postgres via le Sync Stream
// garants (voir docs/backlog.md, chantier PowerSync).
const PROFESSION_MARQUEUR = "MARQUEUR-NE-DOIT-JAMAIS-SYNC-PROFESSION";
const REVENUS_MARQUEUR = "99999.99";

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

    const [bailExistant] = await db.select().from(baux).where(eq(baux.appartementId, appartement.id)).limit(1);
    if (bailExistant) {
      console.log(`Bail déjà présent (${bailExistant.id}) pour "${appartement.numero}" — rien à créer.`);
      return;
    }

    const [bail] = await db
      .insert(baux)
      .values({
        appartementId: appartement.id,
        typeBail: "vide",
        loyerMensuel: "650.00",
        depotGarantie: "650.00",
        dateDebut: "2026-01-01"
      })
      .returning();
    if (!bail) {
      throw new Error("Échec de la création du bail de test");
    }

    const [locataire] = await db
      .insert(locataires)
      .values({
        nom: "Testeur",
        prenom: "Loca",
        email: "loca.testeur@example.test",
        telephone: "0600000000"
      })
      .returning();
    if (!locataire) {
      throw new Error("Échec de la création du locataire de test");
    }

    await db.insert(bailLocataires).values({
      bailId: bail.id,
      locataireId: locataire.id,
      role: "titulaire"
    });

    const [garant] = await db
      .insert(garants)
      .values({
        bailId: bail.id,
        nom: "Testeur",
        prenom: "Garant",
        typeGarantie: "personne_physique",
        profession: PROFESSION_MARQUEUR,
        revenus: REVENUS_MARQUEUR
      })
      .returning();
    if (!garant) {
      throw new Error("Échec de la création du garant de test");
    }

    console.log(`Bail (${bail.id}) créé sous l'appartement "${appartement.numero}".`);
    console.log(`Locataire "${locataire.prenom} ${locataire.nom}" (${locataire.id}) créé et rattaché en tant que titulaire.`);
    console.log(`Garant "${garant.prenom} ${garant.nom}" (${garant.id}) créé — profession="${PROFESSION_MARQUEUR}", revenus="${REVENUS_MARQUEUR}" (à vérifier absents de la sync).`);
  } finally {
    await db.$client.end();
  }
}

void main();
