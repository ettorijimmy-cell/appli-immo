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

// Vrai modèle (Module Suivi sinistre et assurance, 2026-09-16), même
// principe que seed-modele-revision-loyer.ts — texte factuel de relance,
// destiné à l'assureur (contact du Carnet, rôle 'assureur'), jamais au
// locataire. Résolu par TachesJobService.construireMetadataSinistreStagnation
// avec les vraies variables du sinistre concerné.
const CODE_MODELE_SINISTRE_STAGNATION = "sinistre_stagnation";

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
      code: CODE_MODELE_SINISTRE_STAGNATION,
      nom: "Relance assureur — dossier sinistre sans mouvement",
      canal: "email",
      objet: "Relance — dossier sinistre {{typeSinistre}}, {{libelleBien}}",
      corps:
        "Bonjour {{nomAssureur}},\n\n" +
        "Je me permets de revenir vers vous concernant le dossier sinistre ({{typeSinistre}}) déclaré le {{dateDeclaration}} pour le bien {{libelleBien}}, qui n'a connu aucune évolution depuis un certain temps.\n\n" +
        "Pourriez-vous me communiquer l'état d'avancement de ce dossier ?\n\n" +
        "Cordialement.",
      variablesRequises: ["nomAssureur", "libelleBien", "typeSinistre", "dateDeclaration"],
      organisationId
    });
    console.log(`Modèle "${modele.code}" (${modele.id}) upserted pour l'organisation ${organisationId}.`);

    const relu = await modelesCourrierService.findByCode(CODE_MODELE_SINISTRE_STAGNATION);
    if (!relu) {
      throw new Error("findByCode n'a pas retrouvé le modèle qui vient d'être créé");
    }

    const resultat = resoudreModeleCourrier(
      { objet: relu.objet, corps: relu.corps },
      {
        nomAssureur: "Assurances Test",
        libelleBien: "Immeuble Test — n°1",
        typeSinistre: "degat_eaux",
        dateDeclaration: "2026-08-01"
      }
    );
    console.log(`Objet résolu : "${resultat.objet}"`);
    console.log(`Corps résolu :\n${resultat.corps}`);
  } finally {
    await db.$client.end();
  }
}

void main();
