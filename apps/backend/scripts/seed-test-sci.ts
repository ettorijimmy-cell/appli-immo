import { creerRattachementProprietaire } from "core";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisationSci, scis, utilisateurs } from "db";
import { eq } from "drizzle-orm";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

async function main(): Promise<void> {
  const email = parseArg("email");
  if (!email) {
    console.error("Usage : tsx scripts/seed-test-sci.ts --email=... [--nom=\"SCI Test\"]");
    process.exitCode = 1;
    return;
  }
  const nom = parseArg("nom") ?? "SCI Test PowerSync";

  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL;
  const db = createDbClient(databaseUrl);

  try {
    const [user] = await db.select().from(utilisateurs).where(eq(utilisateurs.email, email)).limit(1);
    if (!user) {
      console.error(`Aucun utilisateur avec l'email ${email} — lancer pnpm seed:user d'abord.`);
      process.exitCode = 1;
      return;
    }

    // Même logique que ScisService.create (apps/backend/src/scis/scis.service.ts) :
    // insertion de la SCI puis rattachement propriétaire via packages/core,
    // pour produire exactement la même forme de données qu'une création réelle
    // via l'API — pas une insertion ad hoc divergente.
    const [sci] = await db
      .insert(scis)
      .values({
        nom,
        regimeFiscal: "IR",
        adresse: "1 rue de Test",
        codePostal: "75001",
        ville: "Paris"
      })
      .returning();
    if (!sci) {
      throw new Error("Échec de la création de la SCI de test");
    }

    const rattachement = creerRattachementProprietaire({
      organisationId: user.organisationId,
      sciId: sci.id,
      dateDebut: new Date().toISOString().slice(0, 10)
    });
    await db.insert(organisationSci).values(rattachement);

    console.log(`SCI "${sci.nom}" (${sci.id}) créée et rattachée à l'organisation de ${email}.`);
  } finally {
    await db.$client.end();
  }
}

void main();
