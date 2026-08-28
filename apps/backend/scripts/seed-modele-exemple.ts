import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisationSci, scis } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { resoudreModeleCourrier } from "core";
import { RequestContextService } from "../src/common/request-context";
import { ModelesCourrierService } from "../src/modeles-courrier/modeles-courrier.service";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

// Modèle FICTIF de démonstration — sert uniquement à valider le mécanisme
// de bout en bout (seed -> findByCode -> resoudreModeleCourrier), pas la
// quittance réelle (Module Tâches, Étape 4, docs/backlog.md : le vrai
// contenu de quittance arrivera une fois les données réellement
// disponibles à la génération connues avec certitude). Sert de gabarit
// pour ce futur script, même mécanique que seed-test-bien-appartement.ts
// pour BienService/AppartementsService.
const CODE_MODELE_EXEMPLE = "exemple_demonstration";

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

    const requestContext = new RequestContextService();
    const modelesCourrierService = new ModelesCourrierService(db, requestContext);

    // Même résolution organisation_sci -> organisation que
    // seed-test-bien-appartement.ts : modele_courrier.organisation_id est
    // transmis explicitement par l'appelant (pas dérivé d'un userId comme
    // BienService.create), donc il faut le résoudre nous-mêmes ici.
    const rattachements = await db
      .select()
      .from(organisationSci)
      .where(and(eq(organisationSci.sciId, sci.id), isNull(organisationSci.dateFin)));
    const organisationIds = [...new Set(rattachements.map((r) => r.organisationId))];
    if (organisationIds.length !== 1) {
      console.error(
        `Attendu exactement un rattachement organisation_sci actif pour "${nomSci}", trouvé ${organisationIds.length} — lancer seed:test-sci d'abord.`
      );
      process.exitCode = 1;
      return;
    }
    const organisationId = organisationIds[0]!;

    const modele = await modelesCourrierService.upsertModeleCourrier({
      code: CODE_MODELE_EXEMPLE,
      nom: "Exemple de démonstration (mécanisme modèles de courrier)",
      canal: "email",
      objet: "Bonjour {{prenom}}, un message de test",
      corps:
        "Bonjour {{prenom}} {{nom}},\n\nCeci est un message de démonstration généré le {{date}}.\n\nCordialement.",
      variablesRequises: ["prenom", "nom", "date"],
      organisationId
    });
    console.log(`Modèle "${modele.code}" (${modele.id}) upserted pour l'organisation ${organisationId}.`);

    // Vérification bout-en-bout : findByCode puis resoudreModeleCourrier
    // avec des valeurs de test — c'est ce parcours exact que réutilisera
    // le futur générateur de quittance (Étape 4).
    const relu = await modelesCourrierService.findByCode(CODE_MODELE_EXEMPLE);
    if (!relu) {
      throw new Error("findByCode n'a pas retrouvé le modèle qui vient d'être créé");
    }

    const resultat = resoudreModeleCourrier(
      { objet: relu.objet, corps: relu.corps },
      { prenom: "Ilan", nom: "Devos", date: "2026-08-29" }
    );
    console.log(`Objet résolu : "${resultat.objet}"`);
    console.log(`Corps résolu :\n${resultat.corps}`);
  } finally {
    await db.$client.end();
  }
}

void main();
