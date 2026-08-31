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

// Vrai modèle, contrairement à seed-modele-exemple.ts (Étape 2, texte
// fictif de démonstration) — Module Tâches, Étape 5, docs/backlog.md.
// Texte factuel et neutre : une notification informative, pas un document
// contractuel (pas de formulation juridique complexe). Résolu par
// TachesService.appliquerRevision avec les vraies variables du bail
// concerné.
const CODE_MODELE_REVISION_LOYER = "revision_loyer";

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
    // seed-modele-exemple.ts : modele_courrier.organisation_id est transmis
    // explicitement par l'appelant, jamais dérivé d'un userId.
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
      code: CODE_MODELE_REVISION_LOYER,
      nom: "Révision annuelle du loyer",
      canal: "email",
      objet: "Révision de votre loyer — {{libelleBien}}",
      corps:
        "Bonjour {{nomLocataire}},\n\n" +
        "Conformément à la clause d'indexation de votre contrat de location, le loyer applicable au logement {{libelleBien}} a été révisé.\n\n" +
        "Ancien loyer mensuel hors charges : {{loyerAvant}} €\n" +
        "Nouveau loyer mensuel hors charges, à compter du {{dateEffet}} : {{loyerApres}} €\n\n" +
        "Cette révision est calculée conformément à l'indice de référence des loyers (IRL) publié par l'INSEE.\n\n" +
        "Cordialement.",
      variablesRequises: ["nomLocataire", "libelleBien", "loyerAvant", "loyerApres", "dateEffet"],
      organisationId
    });
    console.log(`Modèle "${modele.code}" (${modele.id}) upserted pour l'organisation ${organisationId}.`);

    // Vérification bout-en-bout : findByCode puis resoudreModeleCourrier
    // avec des valeurs de test — même parcours exact que
    // TachesService.appliquerRevision.
    const relu = await modelesCourrierService.findByCode(CODE_MODELE_REVISION_LOYER);
    if (!relu) {
      throw new Error("findByCode n'a pas retrouvé le modèle qui vient d'être créé");
    }

    const resultat = resoudreModeleCourrier(
      { objet: relu.objet, corps: relu.corps },
      {
        nomLocataire: "Ilan Devos",
        libelleBien: "Immeuble Test — n°1",
        loyerAvant: "700.00",
        loyerApres: "712.23",
        dateEffet: "2027-01-01"
      }
    );
    console.log(`Objet résolu : "${resultat.objet}"`);
    console.log(`Corps résolu :\n${resultat.corps}`);
  } finally {
    await db.$client.end();
  }
}

void main();
