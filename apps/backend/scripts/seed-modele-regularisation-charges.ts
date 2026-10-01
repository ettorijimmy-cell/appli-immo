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

// Vrai modèle, même pattern que seed-modele-revision-loyer.ts — Module
// Régularisation des charges, Sous-commit C, docs/backlog.md. Rappel
// informatif, jamais généré quand le solde est en faveur du locataire ou à
// l'équilibre (affichage seul dans ce cas, voir RegularisationChargesService).
// Résolu par TachesJobService/RegularisationChargesController à la
// génération de la tâche, pas d'étape d'application séparée (contrairement
// à revision_loyer).
const CODE_MODELE_REGULARISATION_CHARGES = "regularisation_charges";

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
      code: CODE_MODELE_REGULARISATION_CHARGES,
      nom: "Régularisation des charges",
      canal: "email",
      objet: "Régularisation des charges — {{libelleBien}}",
      corps:
        "Bonjour {{nomLocataire}},\n\n" +
        "La régularisation annuelle des charges du logement {{libelleBien}} pour la période du {{periodeDebut}} au {{periodeFin}} fait apparaître un solde de {{montant}} € restant à votre charge.\n\n" +
        "Merci de bien vouloir procéder au règlement de ce complément dans les meilleurs délais.\n\n" +
        "Cordialement.",
      variablesRequises: ["nomLocataire", "libelleBien", "montant", "periodeDebut", "periodeFin"],
      organisationId
    });
    console.log(`Modèle "${modele.code}" (${modele.id}) upserted pour l'organisation ${organisationId}.`);

    const relu = await modelesCourrierService.findByCode(CODE_MODELE_REGULARISATION_CHARGES);
    if (!relu) {
      throw new Error("findByCode n'a pas retrouvé le modèle qui vient d'être créé");
    }

    const resultat = resoudreModeleCourrier(
      { objet: relu.objet, corps: relu.corps },
      {
        nomLocataire: "Ilan Devos",
        libelleBien: "Immeuble Test — n°1",
        montant: "250.00",
        periodeDebut: "2026-03-15",
        periodeFin: "2027-03-15"
      }
    );
    console.log(`Objet résolu : "${resultat.objet}"`);
    console.log(`Corps résolu :\n${resultat.corps}`);
  } finally {
    await db.$client.end();
  }
}

void main();
