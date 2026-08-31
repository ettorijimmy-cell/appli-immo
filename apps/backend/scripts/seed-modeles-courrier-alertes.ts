import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisationSci, scis } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { RequestContextService } from "../src/common/request-context";
import { ModelesCourrierService } from "../src/modeles-courrier/modeles-courrier.service";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

// Trois vrais modèles, un par type de tâche dérivée automatiquement d'une
// alerte (impaye/entretien_equipement/document_expire — Module Tâches,
// extension notifications du 2026-08-31, docs/backlog.md). Textes factuels
// et neutres, résolus par TachesJobService.construireMetadataNotification
// avec les vraies variables du bail concerné, dès la génération de la
// tâche (pas d'action manuelle d'application, contrairement à
// revision_loyer).
const MODELES = [
  {
    code: "impaye",
    nom: "Rappel de paiement en attente",
    canal: "email" as const,
    objet: "Rappel — paiement en attente ({{libelleBien}})",
    corps:
      "Bonjour {{nomLocataire}},\n\n" +
      "Nous constatons qu'un paiement de {{typePaiement}} d'un montant de {{montant}} €, échu le {{dateEcheance}}, reste en attente pour le logement {{libelleBien}}.\n\n" +
      "Merci de bien vouloir régulariser cette situation dans les meilleurs délais.\n\n" +
      "Cordialement.",
    variablesRequises: ["nomLocataire", "libelleBien", "montant", "dateEcheance", "typePaiement"]
  },
  {
    code: "entretien_equipement",
    nom: "Entretien d'équipement à prévoir",
    canal: "email" as const,
    objet: "Entretien à prévoir — {{libelleBien}}",
    corps:
      "Bonjour {{nomLocataire}},\n\n" +
      "L'entretien de l'équipement suivant est attendu pour le logement {{libelleBien}} : {{typeEquipement}}, échéance le {{dateEcheance}}.\n\n" +
      "Merci de bien vouloir prendre contact pour convenir d'un rendez-vous.\n\n" +
      "Cordialement.",
    variablesRequises: ["nomLocataire", "libelleBien", "typeEquipement", "dateEcheance"]
  },
  {
    code: "document_expire",
    nom: "Document expiré",
    canal: "email" as const,
    objet: "Document expiré — {{libelleBien}}",
    corps:
      "Bonjour {{nomLocataire}},\n\n" +
      'Le document "{{nomDocument}}" concernant le logement {{libelleBien}} a expiré le {{dateExpiration}}.\n\n' +
      "Merci de bien vouloir transmettre un document à jour dans les meilleurs délais.\n\n" +
      "Cordialement.",
    variablesRequises: ["nomLocataire", "libelleBien", "nomDocument", "dateExpiration"]
  }
];

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

    for (const modele of MODELES) {
      const cree = await modelesCourrierService.upsertModeleCourrier({ ...modele, organisationId });
      console.log(`Modèle "${cree.code}" (${cree.id}) upserted pour l'organisation ${organisationId}.`);
    }
  } finally {
    await db.$client.end();
  }
}

void main();
