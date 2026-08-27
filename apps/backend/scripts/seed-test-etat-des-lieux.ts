import {
  appartements,
  baux,
  bien,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  elementsInventaireMeuble,
  etatDesLieuxCles,
  etatDesLieuxCompteurs,
  etatDesLieuxEquipementsDivers,
  etatDesLieuxInventaire,
  etatDesLieuxPieceCuisine,
  etatDesLieuxPieceEntree,
  etatDesLieuxPieceSejour,
  etatDesLieuxPiecesAutre,
  etatDesLieuxPiecesChambre,
  etatDesLieuxPiecesSalleDeBain,
  etatDesLieuxPiecesWc,
  etatsDesLieux,
  scis
} from "db";
import { asc, eq } from "drizzle-orm";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

// Marqueurs volontairement distinctifs (pas des commentaires plausibles) —
// servent à vérifier ensuite, par recherche littérale dans le fichier
// SQLite local, que commentaire n'a jamais quitté Postgres via les Sync
// Streams cles/equipements_divers/inventaire (voir docs/backlog.md,
// chantier PowerSync, domaine État des lieux).
const MARQUEUR_CLES = "TEST-NE-DOIT-JAMAIS-SYNC-commentaire-cles";
const MARQUEUR_EQUIPEMENTS = "TEST-NE-DOIT-JAMAIS-SYNC-commentaire-equipements";
const MARQUEUR_INVENTAIRE = "TEST-NE-DOIT-JAMAIS-SYNC-commentaire-inventaire";

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

    const [bail] = await db.select().from(baux).where(eq(baux.appartementId, appartement.id)).limit(1);
    if (!bail) {
      console.error(`Aucun bail pour l'appartement "${appartement.numero}" — lancer seed:test-locataire-bail d'abord.`);
      process.exitCode = 1;
      return;
    }

    const [elementInventaire] = await db
      .select()
      .from(elementsInventaireMeuble)
      .orderBy(asc(elementsInventaireMeuble.ordreAffichage))
      .limit(1);
    if (!elementInventaire) {
      console.error("Aucune ligne dans elements_inventaire_meuble — lancer seed:inventaire-meuble d'abord.");
      process.exitCode = 1;
      return;
    }

    const [etatExistant] = await db
      .select()
      .from(etatsDesLieux)
      .where(eq(etatsDesLieux.bailId, bail.id))
      .limit(1);
    if (etatExistant) {
      console.log(`État des lieux déjà présent (${etatExistant.id}) pour le bail ${bail.id} — rien à créer.`);
      return;
    }

    const [etatDesLieux] = await db
      .insert(etatsDesLieux)
      .values({
        bailId: bail.id,
        dateEntree: "2026-08-21"
      })
      .returning();
    if (!etatDesLieux) {
      throw new Error("Échec de la création de l'état des lieux de test");
    }
    const etatDesLieuxId = etatDesLieux.id;

    await db.insert(etatDesLieuxPieceEntree).values({
      etatDesLieuxId,
      porteDescription: "Porte blindée, œilleton",
      porteEtatEntree: "B",
      sonnetteDescription: "Sonnette électrique avec interphone",
      sonnetteEtatEntree: "B",
      murDescription: "Peinture blanche, RAS",
      murEtatEntree: "TB",
      solDescription: "Carrelage gris clair",
      solEtatEntree: "B",
      plafondDescription: "Peinture blanche",
      plafondEtatEntree: "TB",
      eclairageDescription: "Spot encastré",
      eclairageEtatEntree: "B",
      prisesDescription: "Prise simple",
      prisesEtatEntree: "B",
      prisesNombre: 1
    });

    await db.insert(etatDesLieuxPieceSejour).values({
      etatDesLieuxId,
      murDescription: "Peinture beige",
      murEtatEntree: "B",
      solDescription: "Parquet stratifié",
      solEtatEntree: "B",
      vitrageVoletsDescription: "Double vitrage, volets roulants électriques",
      vitrageVoletsEtatEntree: "TB",
      plafondDescription: "Peinture blanche",
      plafondEtatEntree: "B",
      eclairageDescription: "Applique murale",
      eclairageEtatEntree: "B",
      prisesDescription: "3 prises doubles",
      prisesEtatEntree: "B",
      prisesNombre: 6
    });

    await db.insert(etatDesLieuxPieceCuisine).values({
      etatDesLieuxId,
      murDescription: "Carrelage crédence + peinture",
      murEtatEntree: "B",
      solDescription: "Carrelage",
      solEtatEntree: "B",
      vitrageVoletsDescription: "Simple vitrage",
      vitrageVoletsEtatEntree: "B",
      plafondDescription: "Peinture blanche",
      plafondEtatEntree: "B",
      eclairageDescription: "Spot sous meuble haut",
      eclairageEtatEntree: "B",
      prisesDescription: "Prises électroménager",
      prisesEtatEntree: "B",
      prisesNombre: 4,
      placardsDescription: "Meubles hauts et bas",
      placardsEtatEntree: "B",
      evierDescription: "Évier inox une cuve",
      evierEtatEntree: "B",
      plaquesCuissonDescription: "Plaques vitrocéramique 4 feux",
      plaquesCuissonEtatEntree: "TB",
      hotteDescription: "Hotte aspirante",
      hotteEtatEntree: "B",
      electromenagerDescription: "Four et plaques encastrés"
    });

    await db.insert(etatDesLieuxCompteurs).values({
      etatDesLieuxId,
      electriciteNumeroCompteurEntree: "TEST-COMPTEUR-ELEC-001",
      electriciteReleveHpEntree: "1234.50",
      electriciteReleveHcEntree: "567.80",
      gazNumeroCompteurEntree: "TEST-COMPTEUR-GAZ-001",
      gazReleveEntree: "890.10",
      eauReleveFroideEntree: "234.60",
      eauReleveChaudeEntree: "123.40"
    });

    await db.insert(etatDesLieuxPiecesChambre).values({
      etatDesLieuxId,
      numero: 1,
      murDescription: "Peinture bleu clair",
      murEtatEntree: "B",
      solDescription: "Parquet stratifié",
      solEtatEntree: "B",
      vitrageVoletsDescription: "Double vitrage, volets roulants",
      vitrageVoletsEtatEntree: "TB",
      plafondDescription: "Peinture blanche",
      plafondEtatEntree: "B",
      eclairageDescription: "Plafonnier",
      eclairageEtatEntree: "B",
      prisesDescription: "2 prises doubles",
      prisesEtatEntree: "B",
      prisesNombre: 4
    });

    await db.insert(etatDesLieuxPiecesSalleDeBain).values({
      etatDesLieuxId,
      numero: 1,
      murDescription: "Carrelage faïence",
      murEtatEntree: "B",
      solDescription: "Carrelage antidérapant",
      solEtatEntree: "B",
      plafondDescription: "Peinture spéciale humidité",
      plafondEtatEntree: "B",
      eclairageDescription: "Spot étanche",
      eclairageEtatEntree: "B",
      prisesDescription: "Prise rasoir",
      prisesEtatEntree: "B",
      prisesNombre: 1,
      lavaboDescription: "Vasque simple avec meuble",
      lavaboEtatEntree: "B",
      baignoireDescription: "Baignoire avec pare-douche",
      baignoireEtatEntree: "B"
    });

    await db.insert(etatDesLieuxPiecesWc).values({
      etatDesLieuxId,
      numero: 1,
      murDescription: "Peinture blanche",
      murEtatEntree: "B",
      solDescription: "Carrelage",
      solEtatEntree: "B",
      plafondDescription: "Peinture blanche",
      plafondEtatEntree: "B",
      eclairageDescription: "Applique",
      eclairageEtatEntree: "B",
      prisesDescription: "Aucune",
      prisesNombre: 0,
      lavaboDescription: "Lave-mains",
      lavaboEtatEntree: "B",
      wcDescription: "Cuvette suspendue",
      wcEtatEntree: "TB"
    });

    await db.insert(etatDesLieuxPiecesAutre).values({
      etatDesLieuxId,
      numero: 1,
      libelle: "Bureau",
      murDescription: "Peinture grise",
      murEtatEntree: "B",
      solDescription: "Parquet stratifié",
      solEtatEntree: "B",
      plafondDescription: "Peinture blanche",
      plafondEtatEntree: "B",
      eclairageDescription: "Plafonnier",
      eclairageEtatEntree: "B",
      prisesDescription: "1 prise double",
      prisesEtatEntree: "B",
      prisesNombre: 2
    });

    await db.insert(etatDesLieuxCles).values({
      etatDesLieuxId,
      typeCle: "porte_entree",
      nombreEntree: 2,
      commentaire: MARQUEUR_CLES
    });

    await db.insert(etatDesLieuxEquipementsDivers).values({
      etatDesLieuxId,
      libelle: "Détecteur de fumée",
      nombreEntree: 1,
      etatEntree: "bon",
      commentaire: MARQUEUR_EQUIPEMENTS
    });

    await db.insert(etatDesLieuxInventaire).values({
      etatDesLieuxId,
      elementId: elementInventaire.id,
      nombreEntree: 2,
      etatEntree: "bon",
      commentaire: MARQUEUR_INVENTAIRE
    });

    console.log(`État des lieux (${etatDesLieuxId}) créé pour le bail ${bail.id}, appartement "${appartement.numero}".`);
    console.log("4 tables mono-instance (piece_entree, piece_sejour, piece_cuisine, compteurs) remplies.");
    console.log("4 tables multi-instance (pieces_chambre/salle_de_bain/wc/autre) remplies avec numero=1.");
    console.log(`cles créée — commentaire="${MARQUEUR_CLES}" (à vérifier absent de la sync).`);
    console.log(`equipements_divers créée — commentaire="${MARQUEUR_EQUIPEMENTS}" (à vérifier absent de la sync).`);
    console.log(
      `inventaire créée, rattachée à l'élément "${elementInventaire.libelle}" (${elementInventaire.id}) — commentaire="${MARQUEUR_INVENTAIRE}" (à vérifier absent de la sync).`
    );
  } finally {
    await db.$client.end();
  }
}

void main();
