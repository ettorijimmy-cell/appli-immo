import {
  appartements,
  bien,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  diagnostics,
  documents,
  scis
} from "db";
import { eq } from "drizzle-orm";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

// Marqueur volontairement distinctif (pas un chemin plausible) — sert à
// vérifier ensuite, par recherche littérale dans le fichier SQLite local,
// que chemin_stockage n'a jamais quitté Postgres via le Sync Stream
// documents (voir docs/backlog.md, chantier PowerSync). Domaine le plus
// sensible de ce chantier.
const CHEMIN_STOCKAGE_MARQUEUR = "TEST-NE-DOIT-JAMAIS-SYNC-chemin/fictif.pdf";

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

    const [documentExistant] = await db
      .select()
      .from(documents)
      .where(eq(documents.entiteId, appartement.id))
      .limit(1);
    if (documentExistant) {
      console.log(`Document déjà présent (${documentExistant.id}) pour l'appartement "${appartement.numero}" — rien à créer.`);
      return;
    }

    const [document] = await db
      .insert(documents)
      .values({
        entiteType: "appartement",
        entiteId: appartement.id,
        categorie: "dpe",
        nomFichier: "RIB_Test.pdf",
        mimeType: "application/pdf",
        tailleOctets: 12345,
        cheminStockage: CHEMIN_STOCKAGE_MARQUEUR
      })
      .returning();
    if (!document) {
      throw new Error("Échec de la création du document de test");
    }

    const [diagnostic] = await db
      .insert(diagnostics)
      .values({
        documentId: document.id,
        type: "dpe",
        classeDpe: "D"
      })
      .returning();
    if (!diagnostic) {
      throw new Error("Échec de la création du diagnostic de test");
    }

    console.log(`Document (${document.id}) créé sous l'appartement "${appartement.numero}" (${appartement.id}).`);
    console.log(`chemin_stockage = "${CHEMIN_STOCKAGE_MARQUEUR}" (à vérifier absent de la sync).`);
    console.log(`Diagnostic (${diagnostic.id}) créé sous ce document — type=dpe, classe_dpe=D.`);
  } finally {
    await db.$client.end();
  }
}

void main();
