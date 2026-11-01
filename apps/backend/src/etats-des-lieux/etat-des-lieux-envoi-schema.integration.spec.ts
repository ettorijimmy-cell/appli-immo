import { randomUUID } from "crypto";
import {
  appartements,
  baux,
  bien,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  etatDesLieuxEnvoi,
  etatsDesLieux,
  locataires,
  organisations,
  type Database
} from "db";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";

const CHAINE_VIDE_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// Contraintes portées par la base elle-même : elles valent quel que soit le
// code appelant, y compris une requête écrite à la main.
describe("etat_des_lieux_envoi — contraintes de la table (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);
  let db: Database;
  let ligneBase: typeof etatDesLieuxEnvoi.$inferInsert;

  beforeEach(async () => {
    db = await begin();
    const [organisation] = await db.insert(organisations).values({ type: "particulier", nom: "Org Envoi Test" }).returning();
    if (!organisation) throw new Error("Organisation de test non créée");
    const [bienLigne] = await db
      .insert(bien)
      .values({
        organisationId: organisation.id,
        type: "maison",
        proprietaireType: "personne_physique",
        nomProprietaire: "Jean Bailleur",
        nom: "Bien Envoi Test",
        adresse: "1 rue de l'Essai",
        codePostal: "69001",
        ville: "Lyon",
        typeHabitat: "individuel"
      })
      .returning();
    if (!bienLigne) throw new Error("Bien de test non créé");
    const [appartement] = await db.insert(appartements).values({ bienId: bienLigne.id, numero: "1" }).returning();
    if (!appartement) throw new Error("Appartement de test non créé");
    const [bail] = await db
      .insert(baux)
      .values({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "650.00",
        depotGarantie: "650.00",
        provisionsCharges: "30.00",
        jourEcheance: 5
      })
      .returning();
    if (!bail) throw new Error("Bail de test non créé");
    const [etat] = await db.insert(etatsDesLieux).values({ bailId: bail.id }).returning();
    if (!etat) throw new Error("État des lieux de test non créé");
    const [locataire] = await db
      .insert(locataires)
      .values({ nom: "Dupont", prenom: "Jean", organisationId: organisation.id })
      .returning();
    if (!locataire) throw new Error("Locataire de test non créé");
    const [document] = await db
      .insert(documents)
      .values({
        entiteType: "etat_des_lieux",
        entiteId: etat.id,
        categorie: "etat_des_lieux_pdf",
        nomFichier: "etat-des-lieux-sortie.pdf",
        mimeType: "application/pdf",
        tailleOctets: 10,
        cheminStockage: `test/${randomUUID()}.enc`,
        etatDesLieuxPhase: "sortie",
        estEtatDesLieuxFige: true
      })
      .returning();
    if (!document) throw new Error("Document de test non créé");

    ligneBase = {
      etatDesLieuxId: etat.id,
      phase: "sortie",
      locataireId: locataire.id,
      documentId: document.id,
      pdfSha256: CHAINE_VIDE_SHA256,
      demandeId: randomUUID(),
      nomDestinataire: "Jean Dupont",
      adresseUtilisee: "jean.dupont@example.com",
      objet: "État des lieux de sortie",
      tenteLe: new Date(),
      organisationId: organisation.id
    };
  });

  afterEach(async () => {
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  async function inserer(surcharge: Partial<typeof etatDesLieuxEnvoi.$inferInsert> = {}) {
    const [ligne] = await db
      .insert(etatDesLieuxEnvoi)
      .values({ ...ligneBase, ...surcharge })
      .returning();
    if (!ligne) throw new Error("Trace de test non créée");
    return ligne;
  }

  // Un refus Postgres annule toute la transaction en cours : le SAVEPOINT
  // permet de relire la table après coup (docs/error-log.md, [2026-10-30]).
  async function codeErreurPostgres(action: (tx: Database) => Promise<unknown>): Promise<string | undefined> {
    return db
      .transaction(async (tx) => {
        await action(tx as unknown as Database);
        return undefined;
      })
      .catch((erreur: { code?: string; cause?: { code?: string } }) => erreur.cause?.code ?? erreur.code ?? "INCONNU");
  }

  it("une ligne en cours s'insère avec les valeurs par défaut attendues", async () => {
    const ligne = await inserer();

    expect(ligne.statut).toBe("en_cours");
    expect(ligne.version).toBe(1);
    expect(ligne.envoyeLe).toBeNull();
    expect(ligne.messageCommunicationId).toBeNull();
  });

  it("DELETE est refusé par la base, la ligne reste présente", async () => {
    const ligne = await inserer();

    const code = await codeErreurPostgres((tx) => tx.delete(etatDesLieuxEnvoi).where(eq(etatDesLieuxEnvoi.id, ligne.id)));

    expect(code).toBe("23001");
    const restantes = await db.select().from(etatDesLieuxEnvoi).where(eq(etatDesLieuxEnvoi.id, ligne.id));
    expect(restantes).toHaveLength(1);
  });

  it("TRUNCATE est refusé par la base", async () => {
    const ligne = await inserer();

    const code = await codeErreurPostgres((tx) => tx.execute(sql`TRUNCATE TABLE etat_des_lieux_envoi`));

    expect(code).toBe("23001");
    const restantes = await db.select().from(etatDesLieuxEnvoi).where(eq(etatDesLieuxEnvoi.id, ligne.id));
    expect(restantes).toHaveLength(1);
  });

  it("UPDATE reste possible : statut final, et future anonymisation de l'adresse", async () => {
    const ligne = await inserer();

    const [apres] = await db
      .update(etatDesLieuxEnvoi)
      .set({ statut: "envoye", envoyeLe: new Date(), adresseUtilisee: "anonymise" })
      .where(eq(etatDesLieuxEnvoi.id, ligne.id))
      .returning();

    expect(apres?.statut).toBe("envoye");
    expect(apres?.adresseUtilisee).toBe("anonymise");
  });

  it("la même demande ne peut pas viser deux fois le même destinataire", async () => {
    const ligne = await inserer({ statut: "echec", codeErreur: "SMTP_RESEAU" });

    const code = await codeErreurPostgres((tx) =>
      tx.insert(etatDesLieuxEnvoi).values({ ...ligneBase, demandeId: ligne.demandeId })
    );

    expect(code).toBe("23505");
  });

  it("un seul envoi en cours par destinataire et par phase, même avec une autre demande", async () => {
    await inserer();

    const code = await codeErreurPostgres((tx) =>
      tx.insert(etatDesLieuxEnvoi).values({ ...ligneBase, demandeId: randomUUID() })
    );

    expect(code).toBe("23505");
  });

  it("un renvoi après un envoi terminé reste possible", async () => {
    await inserer({ statut: "envoye", envoyeLe: new Date() });

    const renvoi = await inserer({ demandeId: randomUUID() });

    expect(renvoi.statut).toBe("en_cours");
  });

  it("'envoye' exige une date d'envoi, et une date d'envoi exige 'envoye'", async () => {
    expect(
      await codeErreurPostgres((tx) => tx.insert(etatDesLieuxEnvoi).values({ ...ligneBase, statut: "envoye" }))
    ).toBe("23514");
    expect(
      await codeErreurPostgres((tx) =>
        tx.insert(etatDesLieuxEnvoi).values({ ...ligneBase, statut: "indetermine", envoyeLe: new Date() })
      )
    ).toBe("23514");
  });

  it("'echec' exige un code d'erreur", async () => {
    const code = await codeErreurPostgres((tx) => tx.insert(etatDesLieuxEnvoi).values({ ...ligneBase, statut: "echec" }));

    expect(code).toBe("23514");
  });

  it("un locataire référencé par une trace ne peut pas être supprimé", async () => {
    await inserer();

    const code = await codeErreurPostgres((tx) =>
      tx.delete(locataires).where(eq(locataires.id, ligneBase.locataireId))
    );

    expect(code).toBe("23503");
  });
});
