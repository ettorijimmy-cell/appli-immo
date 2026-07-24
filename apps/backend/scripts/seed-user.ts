import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import * as argon2 from "argon2";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs } from "db";
import { eq } from "drizzle-orm";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

async function main(): Promise<void> {
  let email = parseArg("email");
  let password = parseArg("password");

  if (!email || !password) {
    // Une seule interface réutilisée pour les deux questions : en créer une
    // par question casse la lecture sur un stdin non-TTY (piped).
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      email ??= await rl.question("Email : ");
      password ??= await rl.question("Mot de passe : ");
    } finally {
      rl.close();
    }
  }

  if (!email || !password) {
    console.error("Email et mot de passe requis.");
    process.exitCode = 1;
    return;
  }

  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL;
  const db = createDbClient(databaseUrl);

  try {
    const [existingUser] = await db
      .select()
      .from(utilisateurs)
      .where(eq(utilisateurs.email, email))
      .limit(1);
    const motDePasseHash = await argon2.hash(password);

    if (existingUser) {
      await db
        .update(utilisateurs)
        .set({ motDePasseHash, statut: "actif", updatedAt: new Date() })
        .where(eq(utilisateurs.id, existingUser.id));
      console.log(`Mot de passe mis à jour pour ${email}.`);
      return;
    }

    let [organisation] = await db.select().from(organisations).limit(1);
    if (!organisation) {
      [organisation] = await db
        .insert(organisations)
        .values({ type: "particulier", nom: "Organisation personnelle" })
        .returning();
    }
    if (!organisation) {
      throw new Error("Impossible de créer ou trouver une organisation.");
    }

    const nomProvisoire = email.split("@")[0] ?? email;
    await db.insert(utilisateurs).values({
      organisationId: organisation.id,
      email,
      nom: nomProvisoire,
      prenom: nomProvisoire,
      motDePasseHash,
      statut: "actif"
    });

    console.log(`Utilisateur ${email} créé.`);
  } finally {
    await db.$client.end();
  }
}

void main();
