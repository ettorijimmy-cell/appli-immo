import { appartements, createDbClient, DEFAULT_DEV_DATABASE_URL, organisationSci, scis, utilisateurs } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { AppartementsService } from "../src/appartements/appartements.service";
import { RequestContextService } from "../src/common/request-context";
import { BienService } from "../src/bien/bien.service";
import { UsersService } from "../src/users/users.service";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

// Marqueur volontairement distinctif (pas une valeur fiscale plausible) —
// sert à vérifier ensuite, par recherche littérale dans le fichier SQLite
// local, que identifiant_fiscal n'a jamais quitté Postgres via le Sync
// Stream appartements (voir docs/backlog.md, chantier PowerSync).
const IDENTIFIANT_FISCAL_MARQUEUR = "MARQUEUR-NE-DOIT-JAMAIS-SYNC-1234567890";

// Renommé depuis seed-test-immeuble-appartement.ts le 2026-08-27 (dette
// différée de la migration bien, docs/backlog.md) : passe désormais par
// BienService/AppartementsService (le chemin applicatif réel), plutôt que
// par un insert Drizzle direct dans l'ancienne table immeubles — devenue
// immeubles_legacy, définitivement en lecture seule (décision utilisateur).
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
    const usersService = new UsersService(db);
    const bienService = new BienService(db, usersService, requestContext);
    const appartementsService = new AppartementsService(db, requestContext);

    // Même résolution organisation_sci -> utilisateurs que
    // backfill-bien-depuis-immeubles.ts (script désormais supprimé, même
    // logique conservée) : BienService.create() exige un userId réel pour
    // en dériver organisationId, exactement comme une création via l'API.
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
    const [utilisateur] = await db
      .select()
      .from(utilisateurs)
      .where(eq(utilisateurs.organisationId, organisationIds[0]!))
      .limit(1);
    if (!utilisateur) {
      console.error(`Aucun utilisateur trouvé pour l'organisation de "${nomSci}".`);
      process.exitCode = 1;
      return;
    }

    let bien: Awaited<ReturnType<typeof bienService.create>> | null = await bienService
      .findAll(sci.id)
      .then((biens) => biens[0] ?? null);
    if (bien) {
      const [appartementExistant] = await db
        .select()
        .from(appartements)
        .where(eq(appartements.bienId, bien.id))
        .limit(1);
      if (appartementExistant) {
        console.log(`Bien "${bien.nom}" (${bien.id}) et appartement "${appartementExistant.numero}" (${appartementExistant.id}) déjà présents pour "${sci.nom}" — rien à créer.`);
        return;
      }
    } else {
      bien = await bienService.create(utilisateur.id, {
        type: "immeuble",
        proprietaireType: "sci",
        sciId: sci.id,
        nom: "Immeuble Test PowerSync",
        adresse: "2 rue de Test",
        codePostal: "75001",
        ville: "Paris",
        typeHabitat: "collectif",
        regimeJuridique: "copropriete",
        anneeConstruction: 1980
      });
    }

    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "Test-1",
      type: "T2",
      surface: "45.50",
      loyerReference: "650.00",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });

    // identifiantFiscal n'a aucun chemin d'écriture applicatif (donnée
    // fiscale nominative, jamais exposée par CreateAppartementDto/
    // UpdateAppartementDto — voir apps/backend/src/appartements/
    // appartements.service.ts) : seule exception à l'usage exclusif du
    // chemin applicatif dans ce script, nécessaire pour que ce marqueur de
    // test existe réellement en base.
    await db
      .update(appartements)
      .set({ identifiantFiscal: IDENTIFIANT_FISCAL_MARQUEUR })
      .where(eq(appartements.id, appartement.id));

    console.log(`Bien "${bien.nom}" (${bien.id}) créé sous la SCI "${sci.nom}" (${sci.id}).`);
    console.log(`Appartement "${appartement.numero}" (${appartement.id}) créé sous ce bien.`);
    console.log(`identifiant_fiscal = "${IDENTIFIANT_FISCAL_MARQUEUR}" (à vérifier absent de la sync).`);
  } finally {
    await db.$client.end();
  }
}

void main();
