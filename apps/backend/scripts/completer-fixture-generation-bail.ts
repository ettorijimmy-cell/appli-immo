import {
  appartements,
  bailLocataires,
  baux,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  garants,
  immeubles,
  indicesIrl,
  locataires,
  scis
} from "db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { irlEstPerime, validerCompletudeGenerationBail, type DonneesCompletudeGenerationBail } from "core";

// Complète, de façon idempotente, les champs obligatoires à la génération
// du document de bail (packages/core, validerCompletudeGenerationBail) sur
// la fixture "SCI Test PowerSync" — créée uniquement pour tester la
// réplication PowerSync (seed-test-sci.ts et suivants), jamais pensée pour
// satisfaire ces règles métier plus tardives (docs/backlog.md, "Édition
// d'un bail"). Ne touche JAMAIS un champ déjà renseigné — seuls les champs
// null sont complétés, en base réutilisable à volonté. N'invente jamais
// l'indice IRL (donnée économique réelle, pas une donnée de test) :
// signalé seulement si absent/périmé, jamais fabriqué.
//
// Usage : DATABASE_URL="postgresql://...scaleway..." pnpm --filter backend
// exec tsx scripts/completer-fixture-generation-bail.ts [--nom-sci="..."]

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

const VALEURS_TEST = {
  sci: { telephone: "0611111111", estFamiliale: true },
  immeuble: {
    anneeConstruction: 1980,
    typeHabitat: "collectif" as const,
    regimeJuridique: "copropriete" as const
  },
  appartement: {
    equipementCuisine: "Plaques de cuisson, four, réfrigérateur",
    dependancesAnnexes: "Cave",
    nombrePiecesPrincipales: 3,
    modeChauffage: "individuel" as const,
    modeEauChaude: "individuel" as const
  },
  locataire: { adresse: "3 rue de Test", codePostal: "75001", ville: "Paris" },
  garant: { dateNaissance: "1980-01-01", lieuNaissance: "Paris", nationalite: "Française" }
};

async function diagnostiquerBail(
  db: ReturnType<typeof createDbClient>,
  bailId: string,
  appartementId: string,
  immeubleId: string,
  sciId: string
): Promise<void> {
  const [bail] = await db.select().from(baux).where(eq(baux.id, bailId)).limit(1);
  const [appartement] = await db.select().from(appartements).where(eq(appartements.id, appartementId)).limit(1);
  const [immeuble] = await db.select().from(immeubles).where(eq(immeubles.id, immeubleId)).limit(1);
  const [sci] = await db.select().from(scis).where(eq(scis.id, sciId)).limit(1);
  if (!bail || !appartement || !immeuble || !sci) return;

  const liens = await db
    .select()
    .from(bailLocataires)
    .where(and(eq(bailLocataires.bailId, bailId), isNull(bailLocataires.archivedAt)));
  const locatairesDuBail = (
    await Promise.all(
      liens.map(async (lien) => {
        const [l] = await db.select().from(locataires).where(eq(locataires.id, lien.locataireId)).limit(1);
        return l;
      })
    )
  ).filter((l): l is NonNullable<typeof l> => l !== undefined);

  const garantsDuBail = await db
    .select()
    .from(garants)
    .where(and(eq(garants.bailId, bailId), isNull(garants.archivedAt)));

  const [derniereValeurIrl] = await db
    .select()
    .from(indicesIrl)
    .orderBy(desc(indicesIrl.annee), desc(indicesIrl.trimestre))
    .limit(1);
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const irlIndisponible =
    !derniereValeurIrl || irlEstPerime(derniereValeurIrl.dateRecuperation.toISOString().slice(0, 10), aujourdhui);

  const donnees: DonneesCompletudeGenerationBail = {
    sci: {
      telephone: sci.telephone,
      estFamiliale: sci.estFamiliale,
      adresse: sci.adresse,
      codePostal: sci.codePostal,
      ville: sci.ville
    },
    immeuble: {
      anneeConstruction: immeuble.anneeConstruction,
      typeHabitat: immeuble.typeHabitat,
      regimeJuridique: immeuble.regimeJuridique
    },
    appartement: {
      equipementCuisine: appartement.equipementCuisine,
      dependancesAnnexes: appartement.dependancesAnnexes,
      nombrePiecesPrincipales: appartement.nombrePiecesPrincipales,
      modeChauffage: appartement.modeChauffage,
      modeEauChaude: appartement.modeEauChaude
    },
    locataires: locatairesDuBail.map((l) => ({ adresse: l.adresse, codePostal: l.codePostal, ville: l.ville })),
    garants: garantsDuBail.map((g) => ({
      dateNaissance: g.dateNaissance,
      lieuNaissance: g.lieuNaissance,
      nationalite: g.nationalite
    })),
    irlIndisponible
  };

  const champsManquants = validerCompletudeGenerationBail(donnees);
  console.log(
    `  Bail ${bailId} (statut=${bail.statut}) — champsManquants:`,
    champsManquants.length === 0 ? "AUCUN" : champsManquants
  );
  if (irlIndisponible) {
    console.log(
      "    ⚠ IRL indisponible/périmé — non corrigé par ce script (donnée économique réelle, pas une donnée de test). Vérifier indices_irl / le job planifié (Module 6)."
    );
  }
}

async function main(): Promise<void> {
  const nomSci = parseArg("nom-sci") ?? "SCI Test PowerSync";
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL;
  const db = createDbClient(databaseUrl);
  const { host, pathname } = new URL(databaseUrl);
  console.log(`Connexion à : ${host}${pathname}\n`);

  try {
    const [sci] = await db.select().from(scis).where(eq(scis.nom, nomSci)).limit(1);
    if (!sci) {
      console.error(`Aucune SCI nommée "${nomSci}".`);
      process.exitCode = 1;
      return;
    }

    const immeublesDeLaSci = await db.select().from(immeubles).where(eq(immeubles.sciId, sci.id));
    const appartementsParImmeuble = new Map<string, (typeof appartements.$inferSelect)[]>();
    for (const immeuble of immeublesDeLaSci) {
      appartementsParImmeuble.set(
        immeuble.id,
        await db.select().from(appartements).where(eq(appartements.immeubleId, immeuble.id))
      );
    }

    console.log(`=== Diagnostic AVANT correction — SCI "${sci.nom}" (${sci.id}) ===`);
    for (const immeuble of immeublesDeLaSci) {
      for (const appartement of appartementsParImmeuble.get(immeuble.id) ?? []) {
        const bauxDeLAppartement = await db.select().from(baux).where(eq(baux.appartementId, appartement.id));
        for (const bail of bauxDeLAppartement) {
          await diagnostiquerBail(db, bail.id, appartement.id, immeuble.id, sci.id);
        }
      }
    }

    console.log(`\n=== Correction (idempotente — champs déjà renseignés jamais touchés) ===`);

    // SCI
    const sciAMettreAJour: Partial<typeof scis.$inferInsert> = {};
    if (sci.telephone === null) sciAMettreAJour.telephone = VALEURS_TEST.sci.telephone;
    if (sci.estFamiliale === null) sciAMettreAJour.estFamiliale = VALEURS_TEST.sci.estFamiliale;
    if (Object.keys(sciAMettreAJour).length > 0) {
      await db.update(scis).set({ ...sciAMettreAJour, updatedAt: new Date() }).where(eq(scis.id, sci.id));
      console.log(`SCI "${sci.nom}" complétée :`, sciAMettreAJour);
    } else {
      console.log(`SCI "${sci.nom}" déjà complète.`);
    }

    // Immeubles
    for (const immeuble of immeublesDeLaSci) {
      const immeubleAMettreAJour: Partial<typeof immeubles.$inferInsert> = {};
      if (immeuble.anneeConstruction === null) immeubleAMettreAJour.anneeConstruction = VALEURS_TEST.immeuble.anneeConstruction;
      if (immeuble.typeHabitat === null) immeubleAMettreAJour.typeHabitat = VALEURS_TEST.immeuble.typeHabitat;
      if (immeuble.regimeJuridique === null) immeubleAMettreAJour.regimeJuridique = VALEURS_TEST.immeuble.regimeJuridique;
      if (Object.keys(immeubleAMettreAJour).length > 0) {
        await db.update(immeubles).set({ ...immeubleAMettreAJour, updatedAt: new Date() }).where(eq(immeubles.id, immeuble.id));
        console.log(`  Immeuble "${immeuble.nom}" (${immeuble.id}) complété :`, immeubleAMettreAJour);
      } else {
        console.log(`  Immeuble "${immeuble.nom}" (${immeuble.id}) déjà complet.`);
      }

      // Appartements
      for (const appartement of appartementsParImmeuble.get(immeuble.id) ?? []) {
        const appartementAMettreAJour: Partial<typeof appartements.$inferInsert> = {};
        if (appartement.equipementCuisine === null)
          appartementAMettreAJour.equipementCuisine = VALEURS_TEST.appartement.equipementCuisine;
        if (appartement.dependancesAnnexes === null)
          appartementAMettreAJour.dependancesAnnexes = VALEURS_TEST.appartement.dependancesAnnexes;
        if (appartement.nombrePiecesPrincipales === null)
          appartementAMettreAJour.nombrePiecesPrincipales = VALEURS_TEST.appartement.nombrePiecesPrincipales;
        if (appartement.modeChauffage === null) appartementAMettreAJour.modeChauffage = VALEURS_TEST.appartement.modeChauffage;
        if (appartement.modeEauChaude === null) appartementAMettreAJour.modeEauChaude = VALEURS_TEST.appartement.modeEauChaude;
        if (Object.keys(appartementAMettreAJour).length > 0) {
          await db
            .update(appartements)
            .set({ ...appartementAMettreAJour, updatedAt: new Date() })
            .where(eq(appartements.id, appartement.id));
          console.log(`    Appartement "${appartement.numero}" (${appartement.id}) complété :`, appartementAMettreAJour);
        } else {
          console.log(`    Appartement "${appartement.numero}" (${appartement.id}) déjà complet.`);
        }

        // Locataires et garants de chaque bail de cet appartement
        const bauxDeLAppartement = await db.select().from(baux).where(eq(baux.appartementId, appartement.id));
        for (const bail of bauxDeLAppartement) {
          const liens = await db
            .select()
            .from(bailLocataires)
            .where(and(eq(bailLocataires.bailId, bail.id), isNull(bailLocataires.archivedAt)));
          for (const lien of liens) {
            const [locataire] = await db.select().from(locataires).where(eq(locataires.id, lien.locataireId)).limit(1);
            if (!locataire) continue;
            const locataireAMettreAJour: Partial<typeof locataires.$inferInsert> = {};
            if (locataire.adresse === null) locataireAMettreAJour.adresse = VALEURS_TEST.locataire.adresse;
            if (locataire.codePostal === null) locataireAMettreAJour.codePostal = VALEURS_TEST.locataire.codePostal;
            if (locataire.ville === null) locataireAMettreAJour.ville = VALEURS_TEST.locataire.ville;
            if (Object.keys(locataireAMettreAJour).length > 0) {
              await db
                .update(locataires)
                .set({ ...locataireAMettreAJour, updatedAt: new Date() })
                .where(eq(locataires.id, locataire.id));
              console.log(
                `      Locataire "${locataire.prenom} ${locataire.nom}" (${locataire.id}) complété :`,
                locataireAMettreAJour
              );
            } else {
              console.log(`      Locataire "${locataire.prenom} ${locataire.nom}" (${locataire.id}) déjà complet.`);
            }
          }

          const garantsDuBail = await db
            .select()
            .from(garants)
            .where(and(eq(garants.bailId, bail.id), isNull(garants.archivedAt)));
          for (const garant of garantsDuBail) {
            const garantAMettreAJour: Partial<typeof garants.$inferInsert> = {};
            if (garant.dateNaissance === null) garantAMettreAJour.dateNaissance = VALEURS_TEST.garant.dateNaissance;
            if (garant.lieuNaissance === null) garantAMettreAJour.lieuNaissance = VALEURS_TEST.garant.lieuNaissance;
            if (garant.nationalite === null) garantAMettreAJour.nationalite = VALEURS_TEST.garant.nationalite;
            if (Object.keys(garantAMettreAJour).length > 0) {
              await db
                .update(garants)
                .set({ ...garantAMettreAJour, updatedAt: new Date() })
                .where(eq(garants.id, garant.id));
              console.log(`      Garant "${garant.prenom} ${garant.nom}" (${garant.id}) complété :`, garantAMettreAJour);
            } else {
              console.log(`      Garant "${garant.prenom} ${garant.nom}" (${garant.id}) déjà complet.`);
            }
          }
        }
      }
    }

    console.log(`\n=== Diagnostic APRÈS correction ===`);
    for (const immeuble of immeublesDeLaSci) {
      for (const appartement of appartementsParImmeuble.get(immeuble.id) ?? []) {
        const bauxDeLAppartement = await db.select().from(baux).where(eq(baux.appartementId, appartement.id));
        for (const bail of bauxDeLAppartement) {
          await diagnostiquerBail(db, bail.id, appartement.id, immeuble.id, sci.id);
        }
      }
    }
  } finally {
    await db.$client.end();
  }
}

void main();
