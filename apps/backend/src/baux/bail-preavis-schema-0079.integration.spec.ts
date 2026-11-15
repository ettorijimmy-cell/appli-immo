import { randomUUID } from "crypto";
import {
  appartements,
  bailPreavis,
  baux,
  bien,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  organisations,
  utilisateurs,
  type Database
} from "db";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";

// Migration 0079 (résiliation, conception 2 « vrai préavis », 2026-11-15) :
// garanties portées par la base elle-même, vérifiées sans passer par les
// services — CHECK, une seule ligne active par bail, aucune suppression ni
// vidage, ligne figée sauf archivage unique avec son motif.
describe("Migration 0079 — bail_preavis (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);
  let db: Database;
  let organisationId: string;
  let utilisateurId: string;
  let bailId: string;

  beforeEach(async () => {
    db = await begin();
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation migration 0079" })
      .returning();
    organisationId = organisation!.id;
    const [utilisateur] = await db
      .insert(utilisateurs)
      .values({
        organisationId,
        email: `migration-0079-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Migration",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    utilisateurId = utilisateur!.id;
    const [bienLigne] = await db
      .insert(bien)
      .values({
        organisationId,
        type: "maison",
        proprietaireType: "personne_physique",
        nomProprietaire: "Propriétaire Migration",
        adresse: "1 rue de Test",
        codePostal: "75001",
        ville: "Paris"
      })
      .returning();
    const [appartement] = await db.insert(appartements).values({ bienId: bienLigne!.id, numero: "1" }).returning();
    const [bail] = await db
      .insert(baux)
      .values({ appartementId: appartement!.id, typeBail: "vide", dateDebut: "2026-01-01" })
      .returning();
    bailId = bail!.id;
  });

  afterEach(async () => {
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  // Chaque écriture refusée passe dans un point de sauvegarde (transaction
  // imbriquée) : une erreur Postgres annulerait sinon toute la transaction
  // du test.
  function dansUnSavepoint(ecriture: (tx: Database) => Promise<unknown>): Promise<unknown> {
    return db.transaction((tx) => ecriture(tx as unknown as Database));
  }

  function valeursPreavis(surcharges: Partial<typeof bailPreavis.$inferInsert> = {}): typeof bailPreavis.$inferInsert {
    return {
      bailId,
      organisationId,
      auteur: "locataire",
      dateReception: "2027-01-15",
      modeRemise: "lrar",
      dureeMois: 3,
      motifReduit: null,
      dateFinProposee: "2027-04-15",
      dateFin: "2027-04-15",
      dateFinBailAvant: null,
      declareeLe: new Date(),
      declareePar: utilisateurId,
      ...surcharges
    };
  }

  async function preavisEnBase(surcharges: Partial<typeof bailPreavis.$inferInsert> = {}) {
    const [ligne] = await db.insert(bailPreavis).values(valeursPreavis(surcharges)).returning();
    return ligne!;
  }

  async function lignesDuBail() {
    return db.select().from(bailPreavis).where(eq(bailPreavis.bailId, bailId));
  }

  describe("enums", () => {
    it("valeurs prévues, pas une de plus", async () => {
      const valeurs = async (type: string) =>
        (await db.execute<{ valeur: string }>(sql.raw(`SELECT unnest(enum_range(NULL::${type}))::text AS valeur`))).map(
          (ligne) => ligne.valeur
        );
      expect(await valeurs("preavis_auteur")).toEqual(["locataire", "bailleur"]);
      expect(await valeurs("preavis_mode_remise")).toEqual(["lrar", "commissaire_justice", "main_propre"]);
      expect(await valeurs("preavis_motif_fin")).toEqual(["corrige", "annule", "resilie"]);
      expect(await valeurs("preavis_motif_reduit")).toEqual([
        "zone_tendue",
        "premier_emploi",
        "mutation",
        "perte_emploi",
        "nouvel_emploi_apres_perte",
        "sante",
        "violences",
        "rsa_aah",
        "logement_social"
      ]);
    });
  });

  describe("CHECK", () => {
    it("durée de 1 à 6 mois", async () => {
      for (const dureeMois of [0, 7]) {
        await expect(dansUnSavepoint((tx) => tx.insert(bailPreavis).values(valeursPreavis({ dureeMois })))).rejects.toThrow(
          /bail_preavis_duree_mois/
        );
      }
      await preavisEnBase({ dureeMois: 6 });
    });

    it("date de fin jamais avant la date de réception (le même jour accepté)", async () => {
      await expect(
        dansUnSavepoint((tx) => tx.insert(bailPreavis).values(valeursPreavis({ dateFin: "2027-01-14" })))
      ).rejects.toThrow(/bail_preavis_date_fin_apres_reception/);
      await preavisEnBase({ dateFin: "2027-01-15" });
    });

    it("motif de préavis réduit refusé pour un congé du bailleur, accepté pour le locataire", async () => {
      await expect(
        dansUnSavepoint((tx) =>
          tx.insert(bailPreavis).values(valeursPreavis({ auteur: "bailleur", motifReduit: "mutation", dureeMois: 6 }))
        )
      ).rejects.toThrow(/bail_preavis_motif_reduit_locataire/);
      await preavisEnBase({ motifReduit: "mutation", dureeMois: 1, dateFin: "2027-02-15" });
    });

    it("archived_at et motif_fin posés ensemble ou pas du tout", async () => {
      await expect(
        dansUnSavepoint((tx) => tx.insert(bailPreavis).values(valeursPreavis({ archivedAt: new Date() })))
      ).rejects.toThrow(/bail_preavis_archivage_coherent/);
      await expect(
        dansUnSavepoint((tx) => tx.insert(bailPreavis).values(valeursPreavis({ motifFin: "annule" })))
      ).rejects.toThrow(/bail_preavis_archivage_coherent/);
    });
  });

  describe("triggers", () => {
    it("DELETE et TRUNCATE refusés", async () => {
      const ligne = await preavisEnBase();
      await expect(
        dansUnSavepoint((tx) => tx.delete(bailPreavis).where(eq(bailPreavis.id, ligne.id)))
      ).rejects.toThrow(/Suppression interdite/);
      await expect(dansUnSavepoint((tx) => tx.execute(sql`TRUNCATE bail_preavis`))).rejects.toThrow(/Suppression interdite/);
      expect(await lignesDuBail()).toHaveLength(1);
    });

    it("une ligne ne change jamais, sauf pour être archivée une seule fois avec son motif", async () => {
      const ligne = await preavisEnBase();
      const interdit = /ne peut qu'être archivé/;
      for (const valeurs of [
        { dateFin: "2027-04-14" },
        { dateReception: "2027-01-16" },
        { auteur: "bailleur" as const },
        { dureeMois: 2 },
        { modeRemise: "main_propre" as const },
        { dateFinProposee: "2027-04-14" },
        { dateFinBailAvant: "2029-12-31" },
        { declareePar: randomUUID() }
      ]) {
        await expect(
          dansUnSavepoint((tx) => tx.update(bailPreavis).set(valeurs).where(eq(bailPreavis.id, ligne.id)))
        ).rejects.toThrow(interdit);
      }
      // Archivage accompagné d'une autre modification : refusé.
      await expect(
        dansUnSavepoint((tx) =>
          tx
            .update(bailPreavis)
            .set({ archivedAt: new Date(), motifFin: "corrige", dateFin: "2027-04-30" })
            .where(eq(bailPreavis.id, ligne.id))
        )
      ).rejects.toThrow(interdit);

      await db
        .update(bailPreavis)
        .set({ archivedAt: new Date(), motifFin: "annule", version: sql`${bailPreavis.version} + 1` })
        .where(eq(bailPreavis.id, ligne.id));
      // Une seconde fois (ré-archivage, ou retour en arrière) : refusé.
      await expect(
        dansUnSavepoint((tx) =>
          tx.update(bailPreavis).set({ archivedAt: new Date(), motifFin: "resilie" }).where(eq(bailPreavis.id, ligne.id))
        )
      ).rejects.toThrow(interdit);
      await expect(
        dansUnSavepoint((tx) =>
          tx.update(bailPreavis).set({ archivedAt: null, motifFin: null }).where(eq(bailPreavis.id, ligne.id))
        )
      ).rejects.toThrow(interdit);
    });
  });

  describe("unicité de la ligne active", () => {
    it("un seul préavis actif par bail ; une correction archive (motif « corrige ») puis réécrit", async () => {
      const ligne = await preavisEnBase();
      await expect(
        dansUnSavepoint((tx) => tx.insert(bailPreavis).values(valeursPreavis({ dateFin: "2027-04-14" })))
      ).rejects.toThrow(/bail_preavis_actif_unique/);

      await db.update(bailPreavis).set({ archivedAt: new Date(), motifFin: "corrige" }).where(eq(bailPreavis.id, ligne.id));
      await db.insert(bailPreavis).values(valeursPreavis({ dateFin: "2027-04-14" }));

      const lignes = await lignesDuBail();
      expect(lignes).toHaveLength(2);
      expect(lignes.filter((l) => l.archivedAt === null).map((l) => l.dateFin)).toEqual(["2027-04-14"]);
      expect(lignes.filter((l) => l.archivedAt !== null).map((l) => l.motifFin)).toEqual(["corrige"]);
    });
  });
});
