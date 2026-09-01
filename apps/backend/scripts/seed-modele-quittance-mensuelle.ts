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

// Vrai modèle, sur le même modèle que seed-modele-revision-loyer.ts —
// Module Tâches, Étape 4, docs/backlog.md. Texte factuel et neutre : une
// notification informative accompagnant la quittance jointe, pas le
// document lui-même (voir QuittanceDocumentDocxService). Résolu par
// TachesJobService.construireMetadataQuittance avec les vraies variables
// du paiement concerné.
const CODE_MODELE_QUITTANCE_MENSUELLE = "quittance_mensuelle";

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
      code: CODE_MODELE_QUITTANCE_MENSUELLE,
      nom: "Quittance de loyer mensuelle",
      canal: "email",
      objet: "Quittance de loyer — {{periode}} — {{libelleBien}}",
      corps:
        "Bonjour {{nomLocataire}},\n\n" +
        "Veuillez trouver ci-joint la quittance de loyer pour la période de {{periode}}, logement {{libelleBien}}.\n\n" +
        "Montant réglé : {{montant}} €.\n\n" +
        "Cordialement.",
      variablesRequises: ["nomLocataire", "libelleBien", "periode", "montant"],
      organisationId
    });
    console.log(`Modèle "${modele.code}" (${modele.id}) upserted pour l'organisation ${organisationId}.`);

    // Vérification bout-en-bout : findByCode puis resoudreModeleCourrier
    // avec des valeurs de test — même parcours exact que
    // TachesJobService.construireMetadataQuittance.
    const relu = await modelesCourrierService.findByCode(CODE_MODELE_QUITTANCE_MENSUELLE);
    if (!relu) {
      throw new Error("findByCode n'a pas retrouvé le modèle qui vient d'être créé");
    }

    const resultat = resoudreModeleCourrier(
      { objet: relu.objet, corps: relu.corps },
      {
        nomLocataire: "Ilan Devos",
        libelleBien: "Immeuble Test — n°1",
        periode: "juin 2026",
        montant: "800.00"
      }
    );
    console.log(`Objet résolu : "${resultat.objet}"`);
    console.log(`Corps résolu :\n${resultat.corps}`);
  } finally {
    await db.$client.end();
  }
}

void main();
