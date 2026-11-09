import { randomUUID } from "crypto";
import {
  appartements,
  bailLocataires,
  baux,
  bien,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  garantRemiseBail,
  garants,
  locataires,
  organisations,
  utilisateurs,
  type Database
} from "db";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";

// Migration 0078 (chantier garants complet, 2026-11-08) : garanties portées
// par la base elle-même, vérifiées sans passer par les services.
// - CHECK garants_prenom_personne_physique : prénom obligatoire pour une
//   caution personne physique, facultatif pour Visale ;
// - valeurs par défaut des nouvelles colonnes de contexte ;
// - garant_remise_bail : aucune suppression, aucun vidage, ligne figée sauf
//   archivage unique, une seule déclaration active par garant.
describe("Migration 0078 — garants, contexte et remise du bail (intégration Postgres réelle)", () => {
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
      .values({ type: "particulier", nom: "Organisation migration 0078" })
      .returning();
    organisationId = organisation!.id;
    const [utilisateur] = await db
      .insert(utilisateurs)
      .values({
        organisationId,
        email: `migration-0078-${randomUUID()}@example.com`,
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

  async function insererGarant(valeurs: { typeGarantie: "personne_physique" | "garantie_visale"; prenom: string | null }) {
    const [garant] = await db
      .insert(garants)
      .values({ bailId, organisationId, nom: "Durand", ...valeurs })
      .returning();
    return garant!;
  }

  describe("CHECK garants_prenom_personne_physique", () => {
    it("refuse une caution personne physique sans prénom, à l'insertion comme en modification", async () => {
      await expect(
        dansUnSavepoint((tx) =>
          tx.insert(garants).values({ bailId, organisationId, nom: "Durand", prenom: null, typeGarantie: "personne_physique" })
        )
      ).rejects.toThrow(/garants_prenom_personne_physique/);

      const caution = await insererGarant({ typeGarantie: "personne_physique", prenom: "Claire" });
      await expect(
        dansUnSavepoint((tx) => tx.update(garants).set({ prenom: null }).where(eq(garants.id, caution.id)))
      ).rejects.toThrow(/garants_prenom_personne_physique/);
    });

    it("accepte un garant Visale sans prénom, avec son numéro de contrat", async () => {
      const [visale] = await db
        .insert(garants)
        .values({
          bailId,
          organisationId,
          nom: "Action Logement Services (Visale)",
          prenom: null,
          typeGarantie: "garantie_visale",
          numeroContratVisale: "V123456789"
        })
        .returning();
      expect(visale).toMatchObject({ prenom: null, numeroContratVisale: "V123456789" });
    });

    it("refuse de passer en personne physique un garant sans prénom", async () => {
      const visale = await insererGarant({ typeGarantie: "garantie_visale", prenom: null });
      await expect(
        dansUnSavepoint((tx) =>
          tx.update(garants).set({ typeGarantie: "personne_physique" }).where(eq(garants.id, visale.id))
        )
      ).rejects.toThrow(/garants_prenom_personne_physique/);
    });
  });

  describe("valeurs par défaut des nouvelles colonnes", () => {
    it("bail sans assurance loyers impayés, locataire non renseigné, lien sans date d'effet de congé", async () => {
      const [bail] = await db.select().from(baux).where(eq(baux.id, bailId));
      expect(bail?.assuranceLoyersImpayes).toBe(false);

      const [locataire] = await db
        .insert(locataires)
        .values({ organisationId, nom: "Bernard", prenom: "Lucie" })
        .returning();
      expect(locataire?.statutEtudes).toBe("non_renseigne");

      const [lien] = await db
        .insert(bailLocataires)
        .values({ bailId, locataireId: locataire!.id, role: "titulaire" })
        .returning();
      expect(lien?.dateEffetConge).toBeNull();
    });

    it("statut d'études : les 5 valeurs prévues, pas une de plus", async () => {
      const resultat = await db.execute<{ valeur: string }>(
        sql`SELECT unnest(enum_range(NULL::locataire_statut_etudes))::text AS valeur`
      );
      expect(resultat.map((ligne) => ligne.valeur)).toEqual([
        "non_renseigne",
        "aucun",
        "etudiant_boursier",
        "etudiant_non_boursier",
        "apprenti"
      ]);
    });

    it("catégories de documents du garant ajoutées", async () => {
      const resultat = await db.execute<{ valeur: string }>(
        sql`SELECT unnest(enum_range(NULL::document_categorie))::text AS valeur`
      );
      const valeurs = resultat.map((ligne) => ligne.valeur);
      expect(valeurs).toContain("contrat_cautionnement_visale");
      expect(valeurs).toContain("acte_cautionnement_signe");
    });
  });

  describe("garant_remise_bail : garanties portées par la base", () => {
    async function remiseEnBase() {
      const garant = await insererGarant({ typeGarantie: "personne_physique", prenom: "Claire" });
      const [ligne] = await db
        .insert(garantRemiseBail)
        .values({
          garantId: garant.id,
          organisationId,
          dateRemise: "2026-11-01",
          mode: "main_propre",
          declareeLe: new Date(),
          declareePar: utilisateurId
        })
        .returning();
      return { garant, ligne: ligne! };
    }

    async function lignesRemise(garantId: string) {
      return db.select().from(garantRemiseBail).where(eq(garantRemiseBail.garantId, garantId));
    }

    it("DELETE et TRUNCATE refusés", async () => {
      const { garant, ligne } = await remiseEnBase();
      await expect(
        dansUnSavepoint((tx) => tx.delete(garantRemiseBail).where(eq(garantRemiseBail.id, ligne.id)))
      ).rejects.toThrow(/Suppression interdite/);
      await expect(dansUnSavepoint((tx) => tx.execute(sql`TRUNCATE garant_remise_bail`))).rejects.toThrow(
        /Suppression interdite/
      );
      expect(await lignesRemise(garant.id)).toHaveLength(1);
    });

    it("une ligne ne change jamais, sauf pour être archivée une seule fois", async () => {
      const { ligne } = await remiseEnBase();
      const interdit = /ne peut qu'être archivée/;
      for (const valeurs of [
        { dateRemise: "2026-10-01" },
        { mode: "email" as const },
        { declareePar: randomUUID() },
        { archivedAt: null }
      ]) {
        await expect(
          dansUnSavepoint((tx) => tx.update(garantRemiseBail).set(valeurs).where(eq(garantRemiseBail.id, ligne.id)))
        ).rejects.toThrow(interdit);
      }
      await expect(
        dansUnSavepoint((tx) =>
          tx
            .update(garantRemiseBail)
            .set({ archivedAt: new Date(), mode: "email" })
            .where(eq(garantRemiseBail.id, ligne.id))
        )
      ).rejects.toThrow(interdit);

      await db.update(garantRemiseBail).set({ archivedAt: new Date() }).where(eq(garantRemiseBail.id, ligne.id));
      await expect(
        dansUnSavepoint((tx) =>
          tx.update(garantRemiseBail).set({ archivedAt: new Date() }).where(eq(garantRemiseBail.id, ligne.id))
        )
      ).rejects.toThrow(interdit);
    });

    it("une seule déclaration active par garant ; une correction archive puis réécrit", async () => {
      const { garant, ligne } = await remiseEnBase();
      const nouvelle = {
        garantId: garant.id,
        organisationId,
        dateRemise: "2026-11-02",
        mode: "lettre_recommandee" as const,
        declareeLe: new Date(),
        declareePar: utilisateurId
      };
      await expect(dansUnSavepoint((tx) => tx.insert(garantRemiseBail).values(nouvelle))).rejects.toThrow(
        /garant_remise_bail_active_unique/
      );

      await db.update(garantRemiseBail).set({ archivedAt: new Date() }).where(eq(garantRemiseBail.id, ligne.id));
      await db.insert(garantRemiseBail).values(nouvelle);
      const lignes = await lignesRemise(garant.id);
      expect(lignes).toHaveLength(2);
      expect(lignes.filter((l) => l.archivedAt === null).map((l) => l.mode)).toEqual(["lettre_recommandee"]);
    });
  });
});
