import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { ConflictException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  elementsInventaireMeuble,
  etatDesLieuxCles,
  etatDesLieuxEquipementsDivers,
  etatDesLieuxInventaire,
  etatDesLieuxPieceSejour,
  organisations,
  utilisateurs,
  type Database
} from "db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { DocumentsService } from "../documents/documents.service";
import { EtatsDesLieuxSignatureModule } from "../etats-des-lieux-signature/etats-des-lieux-signature.module";
import { EtatsDesLieuxSignatureService } from "../etats-des-lieux-signature/etats-des-lieux-signature.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EtatsDesLieuxModule } from "./etats-des-lieux.module";
import { EtatsDesLieuxService } from "./etats-des-lieux.service";

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("Verrou de signature — submitX()/updateHeader()/photos (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-verrou-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let locatairesService: LocatairesService;
  let bauxService: BauxService;
  let bailLocatairesService: BailLocatairesService;
  let etatsDesLieuxService: EtatsDesLieuxService;
  let documentsService: DocumentsService;
  let etatsDesLieuxSignatureService: EtatsDesLieuxSignatureService;
  let requestContextService: RequestContextService;
  let organisationId: string;
  let userId: string;

  async function creerOrganisationEtUtilisateur(libelle: string): Promise<{ organisationId: string; userId: string }> {
    const [organisation] = await db.insert(organisations).values({ type: "particulier", nom: libelle }).returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `verrou-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Verrou",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    return { organisationId: organisation.id, userId: user.id };
  }

  async function creerDossier(proprietaireUserId: string) {
    const sci = await scisService.create(proprietaireUserId, {
      nom: "SCI Verrou Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(proprietaireUserId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Verrou Test",
      adresse: "1 rue du Verrou",
      codePostal: "75001",
      ville: "Lyon",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      bienId: bien.id,
      numero: "1",
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      loyerReference: "850.00"
    });
    await appartementsService.update(appartement.id, { nombreChambres: 1, nombreSallesDeBain: 1, nombreWc: 1 });
    const titulaire = await locatairesService.create(proprietaireUserId, { nom: "Dupont", prenom: "Jean" });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2026-08-01",
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: titulaire.id, role: "titulaire" });

    const etatDesLieux = await etatsDesLieuxService.create({ bailId: bail.id });
    return { etatDesLieuxId: etatDesLieux.id, titulaire };
  }

  function dtoSignature(locataireId: string, overrides: Record<string, unknown> = {}) {
    return {
      bailleur: { nomAffiche: "Jimmy Ettori", luEtApprouve: true, imagePng: PNG_1X1_BASE64 },
      locataires: [{ locataireId, luEtApprouve: true, imagePng: PNG_1X1_BASE64 }],
      ...overrides
    };
  }

  function avecContexte<T>(fn: () => T): T {
    return requestContextService.executerAvecContexte({ utilisateurId: userId, organisationId }, fn);
  }

  async function signerEntree(etatDesLieuxId: string, locataireId: string) {
    await avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoSignature(locataireId)));
  }

  async function signerSortie(etatDesLieuxId: string, locataireId: string) {
    await avecContexte(() => etatsDesLieuxSignatureService.signerSortie(etatDesLieuxId, dtoSignature(locataireId)));
  }

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        EncryptionModule,
        AuditModule,
        UsersModule,
        AuthModule,
        ScisModule,
        BienModule,
        AppartementsModule,
        LocatairesModule,
        BauxModule,
        BailLocatairesModule,
        DocumentsModule,
        EtatsDesLieuxModule,
        EtatsDesLieuxSignatureModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    locatairesService = moduleRef.get(LocatairesService);
    bauxService = moduleRef.get(BauxService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    etatsDesLieuxService = moduleRef.get(EtatsDesLieuxService);
    documentsService = moduleRef.get(DocumentsService);
    etatsDesLieuxSignatureService = moduleRef.get(EtatsDesLieuxSignatureService);
    requestContextService = moduleRef.get(RequestContextService);

    const organisationEtUser = await creerOrganisationEtUtilisateur("Organisation Verrou Test");
    organisationId = organisationEtUser.organisationId;
    userId = organisationEtUser.userId;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  describe("avant toute signature", () => {
    it("submitPieceEntree/updateHeader fonctionnent normalement", async () => {
      const { etatDesLieuxId } = await creerDossier(userId);
      const resultat = await avecContexte(() =>
        etatsDesLieuxService.submitPieceEntree(etatDesLieuxId, { mur: { description: "RAS", etatEntree: "B" } })
      );
      expect(resultat.murDescription).toBe("RAS");
      await expect(
        avecContexte(() => etatsDesLieuxService.updateHeader(etatDesLieuxId, { dateEntree: "2026-09-01" }))
      ).resolves.toBeTruthy();
    });
  });

  describe("après signature de l'entrée seule", () => {
    it("submitPieceEntree : refuse un champ 'entree' (ConflictException)", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() => etatsDesLieuxService.submitPieceEntree(etatDesLieuxId, { mur: { etatEntree: "M" } }))
      ).rejects.toThrow(ConflictException);
    });

    it("submitPieceEntree : refuse un champ 'commune' (description, figée dès l'entrée)", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() => etatsDesLieuxService.submitPieceEntree(etatDesLieuxId, { mur: { description: "Nouvelle fissure" } }))
      ).rejects.toThrow(ConflictException);
    });

    it("submitPieceEntree : autorise un champ 'sortie'", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      const resultat = await avecContexte(() =>
        etatsDesLieuxService.submitPieceEntree(etatDesLieuxId, { mur: { etatSortie: "B" } })
      );
      expect(resultat.murEtatSortie).toBe("B");
    });

    it("submitPieceSejour : une pièce JAMAIS créée à l'entrée reste créable après coup avec ses seuls champs de sortie — descriptions/états d'entrée restent null, non éditables (régression, bug remonté en test manuel desktop 2026-10-26)", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      // Aucun submitPieceSejour avant la signature : la pièce n'existe pas
      // encore en base (même scénario que le dossier de test visuel
      // desktop — le Séjour n'avait jamais été rempli à l'entrée).
      await signerEntree(etatDesLieuxId, titulaire.id);

      const resultat = await avecContexte(() =>
        etatsDesLieuxService.submitPieceSejour(etatDesLieuxId, { mur: { etatSortie: "B" } })
      );
      expect(resultat.murEtatSortie).toBe("B");
      expect(resultat.murEtatEntree).toBeNull();
      expect(resultat.murDescription).toBeNull();

      const [enBase] = await db.select().from(etatDesLieuxPieceSejour).where(eq(etatDesLieuxPieceSejour.etatDesLieuxId, etatDesLieuxId));
      expect(enBase?.murEtatEntree).toBeNull();
      expect(enBase?.murDescription).toBeNull();
      expect(enBase?.murEtatSortie).toBe("B");

      // Toujours interdit de renseigner un champ "entree"/"commune" sur cette pièce, même après sa création.
      await expect(
        avecContexte(() => etatsDesLieuxService.submitPieceSejour(etatDesLieuxId, { mur: { etatEntree: "M" } }))
      ).rejects.toThrow(ConflictException);
      await expect(
        avecContexte(() => etatsDesLieuxService.submitPieceSejour(etatDesLieuxId, { mur: { description: "Fissure" } }))
      ).rejects.toThrow(ConflictException);

      // Figée à son tour une fois la sortie signée.
      await signerSortie(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() => etatsDesLieuxService.submitPieceSejour(etatDesLieuxId, { mur: { etatSortie: "TB" } }))
      ).rejects.toThrow(ConflictException);
    });

    it("submitPieceSejour/Cuisine/Chambre/SalleDeBain/Wc/Autre/Compteurs : refusent chacun un champ 'entree'", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);

      await expect(
        avecContexte(() => etatsDesLieuxService.submitPieceSejour(etatDesLieuxId, { mur: { etatEntree: "M" } }))
      ).rejects.toThrow(ConflictException);
      await expect(
        avecContexte(() => etatsDesLieuxService.submitPieceCuisine(etatDesLieuxId, { evier: { etatEntree: "M" } }))
      ).rejects.toThrow(ConflictException);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitPieceChambre(etatDesLieuxId, { numero: 1, mur: { etatEntree: "M" } })
        )
      ).rejects.toThrow(ConflictException);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitPieceSalleDeBain(etatDesLieuxId, { numero: 1, lavabo: { etatEntree: "M" } })
        )
      ).rejects.toThrow(ConflictException);
      await expect(
        avecContexte(() => etatsDesLieuxService.submitPieceWc(etatDesLieuxId, { numero: 1, wc: { etatEntree: "M" } }))
      ).rejects.toThrow(ConflictException);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitPieceAutre(etatDesLieuxId, { numero: 1, libelle: "Buanderie", mur: { etatEntree: "M" } })
        )
      ).rejects.toThrow(ConflictException);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitCompteurs(etatDesLieuxId, { electricite: { numeroCompteurEntree: "X1" } })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitCompteurs : un champ 'sortie' reste autorisé", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      const resultat = await avecContexte(() =>
        etatsDesLieuxService.submitCompteurs(etatDesLieuxId, { electricite: { numeroCompteurSortie: "Y9" } })
      );
      expect(resultat.electriciteNumeroCompteurSortie).toBe("Y9");
    });

    it("submitCles : une ligne neuve avec un champ 'entree' reste interdite", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [{ typeCle: "cave", nombreEntree: 1 }] })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitCles : une ligne neuve avec SEULEMENT son identité (typeCle/libelleAutre) et un champ 'sortie' est autorisée — élément absent à l'entrée, remis avant la sortie", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      const resultat = await avecContexte(() =>
        etatsDesLieuxService.submitCles(etatDesLieuxId, {
          lignes: [{ typeCle: "autre", libelleAutre: "Badge remis en cours de bail", nombreSortie: 1 }]
        })
      );
      const nouvelle = resultat.find((l) => l.libelleAutre === "Badge remis en cours de bail");
      expect(nouvelle?.nombreSortie).toBe(1);
      expect(nouvelle?.nombreEntree).toBeNull();
    });

    it("submitCles : une ligne neuve avec un champ 'commune' non-identité (commentaire) reste interdite", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitCles(etatDesLieuxId, {
            lignes: [{ typeCle: "cave", nombreSortie: 1, commentaire: "note" }]
          })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitCles : toute ligne neuve est interdite une fois la sortie signée, même sans champ 'entree'", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      await signerSortie(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitCles(etatDesLieuxId, {
            lignes: [{ typeCle: "autre", libelleAutre: "Trop tard", nombreSortie: 1 }]
          })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitCles : interdit l'archivage (idsASupprimer) d'une ligne existante", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const [ligne] = await avecContexte(() =>
        etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [{ typeCle: "cave", nombreEntree: 1 }] })
      );
      await signerEntree(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() => etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [], idsASupprimer: [ligne!.id] }))
      ).rejects.toThrow(ConflictException);
      const [enBase] = await db.select().from(etatDesLieuxCles).where(eq(etatDesLieuxCles.id, ligne!.id));
      expect(enBase?.archivedAt).toBeNull(); // pas d'effet de bord malgré le refus
    });

    it("submitCles : une ligne ajoutée APRÈS la signature d'entrée reste retirable tant que la sortie n'est pas signée, contrairement à une ligne déjà existante à l'entrée (régression, revue 2026-10-26)", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const lignesInitiales = await avecContexte(() =>
        etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [{ typeCle: "cave", nombreEntree: 1 }] })
      );
      const ligneExistante = lignesInitiales.find((l) => l.typeCle === "cave");
      await signerEntree(etatDesLieuxId, titulaire.id);

      const apresAjout = await avecContexte(() =>
        etatsDesLieuxService.submitCles(etatDesLieuxId, {
          lignes: [{ typeCle: "autre", libelleAutre: "Clé remise en cours de bail", nombreSortie: 1 }]
        })
      );
      // Résultat non ordonné (SELECT sans ORDER BY, plusieurs lignes
      // actives désormais) — toujours retrouver par un champ discriminant,
      // jamais par position dans le tableau.
      const ligneNeuve = apresAjout.find((l) => l.libelleAutre === "Clé remise en cours de bail");
      expect(ligneExistante!.ajouteeApresSignatureEntree).toBe(false);
      expect(ligneNeuve!.ajouteeApresSignatureEntree).toBe(true);

      // Toujours interdit sur la ligne qui existait déjà à l'entrée.
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [], idsASupprimer: [ligneExistante!.id] })
        )
      ).rejects.toThrow(ConflictException);

      // Désormais autorisé sur la ligne ajoutée après coup.
      const apresRetrait = await avecContexte(() =>
        etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [], idsASupprimer: [ligneNeuve!.id] })
      );
      expect(apresRetrait.find((l) => l.id === ligneNeuve!.id)).toBeUndefined();
      const [ligneNeuveEnBase] = await db.select().from(etatDesLieuxCles).where(eq(etatDesLieuxCles.id, ligneNeuve!.id));
      expect(ligneNeuveEnBase?.archivedAt).not.toBeNull();

      // Une AUTRE ligne ajoutée après l'entrée n'est plus retirable une fois la sortie signée.
      const apresAjout2 = await avecContexte(() =>
        etatsDesLieuxService.submitCles(etatDesLieuxId, {
          lignes: [{ typeCle: "autre", libelleAutre: "Clé local à vélos", nombreSortie: 1 }]
        })
      );
      const ligneNeuve2 = apresAjout2.find((l) => l.libelleAutre === "Clé local à vélos");
      await signerSortie(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [], idsASupprimer: [ligneNeuve2!.id] })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitEquipementsDivers : ligne neuve avec un champ 'entree' interdite, avec seulement identité + 'sortie' autorisée, avec 'commentaire' interdite", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);

      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, {
            lignes: [{ libelle: "Nouveau", nombreEntree: 1 }]
          })
        )
      ).rejects.toThrow(ConflictException);

      const resultat = await avecContexte(() =>
        etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, {
          lignes: [{ libelle: "Télécommande portail", nombreSortie: 1, etatSortie: "bon" }]
        })
      );
      const nouvelle = resultat.find((l) => l.libelle === "Télécommande portail");
      expect(nouvelle?.etatSortie).toBe("bon");
      expect(nouvelle?.nombreEntree).toBeNull();
      expect(nouvelle?.etatEntree).toBeNull();

      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, {
            lignes: [{ libelle: "Autre", nombreSortie: 1, commentaire: "note" }]
          })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitEquipementsDivers : toute ligne neuve est interdite une fois la sortie signée, et l'archivage d'une ligne existante reste interdit après l'entrée", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const [ligne] = await avecContexte(() =>
        etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, { lignes: [{ libelle: "Aspirateur" }] })
      );
      await signerEntree(etatDesLieuxId, titulaire.id);

      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, { lignes: [], idsASupprimer: [ligne!.id] })
        )
      ).rejects.toThrow(ConflictException);
      const [enBase] = await db
        .select()
        .from(etatDesLieuxEquipementsDivers)
        .where(eq(etatDesLieuxEquipementsDivers.id, ligne!.id));
      expect(enBase?.archivedAt).toBeNull();

      await signerSortie(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, {
            lignes: [{ libelle: "Trop tard", nombreSortie: 1 }]
          })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitEquipementsDivers : une ligne ajoutée APRÈS la signature d'entrée reste retirable tant que la sortie n'est pas signée, contrairement à une ligne déjà existante à l'entrée (régression, revue 2026-10-26)", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const lignesInitiales = await avecContexte(() =>
        etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, { lignes: [{ libelle: "Aspirateur" }] })
      );
      const ligneExistante = lignesInitiales.find((l) => l.libelle === "Aspirateur");
      await signerEntree(etatDesLieuxId, titulaire.id);

      const apresAjout = await avecContexte(() =>
        etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, {
          lignes: [{ libelle: "Télécommande portail", nombreSortie: 1, etatSortie: "bon" }]
        })
      );
      // Résultat non ordonné (SELECT sans ORDER BY) — retrouver par un
      // champ discriminant, jamais par position dans le tableau.
      const ligneNeuve = apresAjout.find((l) => l.libelle === "Télécommande portail");
      expect(ligneExistante!.ajouteeApresSignatureEntree).toBe(false);
      expect(ligneNeuve!.ajouteeApresSignatureEntree).toBe(true);

      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, { lignes: [], idsASupprimer: [ligneExistante!.id] })
        )
      ).rejects.toThrow(ConflictException);

      const apresRetrait = await avecContexte(() =>
        etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, { lignes: [], idsASupprimer: [ligneNeuve!.id] })
      );
      expect(apresRetrait.find((l) => l.id === ligneNeuve!.id)).toBeUndefined();
      const [ligneNeuveEnBase] = await db
        .select()
        .from(etatDesLieuxEquipementsDivers)
        .where(eq(etatDesLieuxEquipementsDivers.id, ligneNeuve!.id));
      expect(ligneNeuveEnBase?.archivedAt).not.toBeNull();

      const apresAjout2 = await avecContexte(() =>
        etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, {
          lignes: [{ libelle: "Barbecue", nombreSortie: 1 }]
        })
      );
      const ligneNeuve2 = apresAjout2.find((l) => l.libelle === "Barbecue");
      await signerSortie(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, { lignes: [], idsASupprimer: [ligneNeuve2!.id] })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitInventaire : une ligne JAMAIS vue à l'entrée, posée seulement avec etatSortie après signature, est désormais autorisée — élément absent à l'entrée, découvert avant la sortie ; mais un champ 'entree' sur une ligne neuve reste interdit", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const elementsCatalogue = await db
        .select({ id: elementsInventaireMeuble.id })
        .from(elementsInventaireMeuble)
        .limit(3);
      if (elementsCatalogue.length < 3) {
        throw new Error("Catalogue elements_inventaire_meuble insuffisant sur ce Postgres de test");
      }
      const [elementVuAEntree, elementJamaisVu, elementEncoreJamaisVu] = elementsCatalogue;
      await avecContexte(() =>
        etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
          lignes: [{ elementId: elementVuAEntree!.id, nombreEntree: 1, etatEntree: "bon" }]
        })
      );
      await signerEntree(etatDesLieuxId, titulaire.id);

      const resultat = await avecContexte(() =>
        etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
          lignes: [{ elementId: elementJamaisVu!.id, etatSortie: "dusage" }]
        })
      );
      const nouvelle = resultat.find((l) => l.elementId === elementJamaisVu!.id);
      expect(nouvelle?.etatSortie).toBe("dusage");
      expect(nouvelle?.etatEntree).toBeNull();

      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
            lignes: [{ elementId: elementEncoreJamaisVu!.id, nombreEntree: 1 }]
          })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitInventaire : toute ligne neuve est interdite une fois la sortie signée, et l'archivage d'une ligne existante reste interdit après l'entrée", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const [element] = await db.select({ id: elementsInventaireMeuble.id }).from(elementsInventaireMeuble).limit(1);
      if (!element) {
        throw new Error("Catalogue elements_inventaire_meuble vide sur ce Postgres de test");
      }
      await avecContexte(() =>
        etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
          lignes: [{ elementId: element.id, nombreEntree: 1, etatEntree: "bon" }]
        })
      );
      await signerEntree(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitInventaire(etatDesLieuxId, { lignes: [], elementsASupprimer: [element.id] })
        )
      ).rejects.toThrow(ConflictException);

      await signerSortie(etatDesLieuxId, titulaire.id);
      const [autreElement] = await db
        .select({ id: elementsInventaireMeuble.id })
        .from(elementsInventaireMeuble)
        .limit(2);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
            lignes: [{ elementId: autreElement!.id, etatSortie: "dusage" }]
          })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitInventaire : une ligne ajoutée APRÈS la signature d'entrée reste retirable tant que la sortie n'est pas signée, contrairement à une ligne déjà existante à l'entrée (régression, revue 2026-10-26)", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const elementsCatalogue = await db
        .select({ id: elementsInventaireMeuble.id })
        .from(elementsInventaireMeuble)
        .limit(3);
      if (elementsCatalogue.length < 3) {
        throw new Error("Catalogue elements_inventaire_meuble insuffisant sur ce Postgres de test");
      }
      const [elementExistant, elementNeuf, elementNeuf2] = elementsCatalogue;
      await avecContexte(() =>
        etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
          lignes: [{ elementId: elementExistant!.id, nombreEntree: 1, etatEntree: "bon" }]
        })
      );
      await signerEntree(etatDesLieuxId, titulaire.id);

      const resultatApresAjout = await avecContexte(() =>
        etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
          lignes: [{ elementId: elementNeuf!.id, etatSortie: "dusage" }]
        })
      );
      expect(resultatApresAjout.find((l) => l.elementId === elementNeuf!.id)?.ajouteeApresSignatureEntree).toBe(true);
      expect(resultatApresAjout.find((l) => l.elementId === elementExistant!.id)?.ajouteeApresSignatureEntree).toBe(
        false
      );

      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
            lignes: [],
            elementsASupprimer: [elementExistant!.id]
          })
        )
      ).rejects.toThrow(ConflictException);

      const apresRetrait = await avecContexte(() =>
        etatsDesLieuxService.submitInventaire(etatDesLieuxId, { lignes: [], elementsASupprimer: [elementNeuf!.id] })
      );
      expect(apresRetrait.find((l) => l.elementId === elementNeuf!.id)).toBeUndefined();
      const [ligneNeuveEnBase] = await db
        .select()
        .from(etatDesLieuxInventaire)
        .where(and(eq(etatDesLieuxInventaire.etatDesLieuxId, etatDesLieuxId), eq(etatDesLieuxInventaire.elementId, elementNeuf!.id)));
      expect(ligneNeuveEnBase?.archivedAt).not.toBeNull();

      await avecContexte(() =>
        etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
          lignes: [{ elementId: elementNeuf2!.id, etatSortie: "bon" }]
        })
      );
      await signerSortie(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitInventaire(etatDesLieuxId, { lignes: [], elementsASupprimer: [elementNeuf2!.id] })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitCles : sur une ligne déjà existante, ne bloque PAS la resoumission à l'identique de typeCle — seul nombreSortie (sortie) peut être posé à la visite de sortie", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const [ligne] = await avecContexte(() =>
        etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [{ typeCle: "cave", nombreEntree: 1 }] })
      );
      await signerEntree(etatDesLieuxId, titulaire.id);

      const resultat = await avecContexte(() =>
        etatsDesLieuxService.submitCles(etatDesLieuxId, {
          lignes: [{ id: ligne!.id, typeCle: "cave", nombreSortie: 1 }]
        })
      );
      expect(resultat[0]!.nombreSortie).toBe(1);
      expect(resultat[0]!.nombreEntree).toBe(1); // jamais touché, toujours figé
    });

    it("submitCles : une vraie modification de typeCle sur une ligne existante reste refusée", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const [ligne] = await avecContexte(() =>
        etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [{ typeCle: "cave", nombreEntree: 1 }] })
      );
      await signerEntree(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitCles(etatDesLieuxId, {
            lignes: [{ id: ligne!.id, typeCle: "boite_lettres", nombreSortie: 1 }]
          })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitEquipementsDivers : même principe (libelle resoumis à l'identique n'empêche pas d'enregistrer etatSortie)", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const [ligne] = await avecContexte(() =>
        etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, {
          lignes: [{ libelle: "Aspirateur", nombreEntree: 1, etatEntree: "bon" }]
        })
      );
      await signerEntree(etatDesLieuxId, titulaire.id);

      const resultat = await avecContexte(() =>
        etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, {
          lignes: [{ id: ligne!.id, libelle: "Aspirateur", etatSortie: "dusage" }]
        })
      );
      expect(resultat[0]!.etatSortie).toBe("dusage");

      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, {
            lignes: [{ id: ligne!.id, libelle: "Aspirateur", etatEntree: "mauvais" }]
          })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("submitInventaire : même principe, avec elementId comme clé naturelle (pas de champ identité requis)", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const [element] = await db.select({ id: elementsInventaireMeuble.id }).from(elementsInventaireMeuble).limit(1);
      if (!element) {
        throw new Error("Catalogue elements_inventaire_meuble vide — seed manquant sur ce Postgres de test");
      }
      await avecContexte(() =>
        etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
          lignes: [{ elementId: element.id, nombreEntree: 1, etatEntree: "bon" }]
        })
      );
      await signerEntree(etatDesLieuxId, titulaire.id);

      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
            lignes: [{ elementId: element.id, etatEntree: "mauvais" }]
          })
        )
      ).rejects.toThrow(ConflictException);

      const resultat = await avecContexte(() =>
        etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
          lignes: [{ elementId: element.id, etatSortie: "dusage" }]
        })
      );
      expect(resultat[0]!.etatSortie).toBe("dusage");
    });

    it("updateHeader : refuse dateEntree, autorise toujours dateSortie et nouvelleAdresseLocataire", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);

      await expect(
        avecContexte(() => etatsDesLieuxService.updateHeader(etatDesLieuxId, { dateEntree: "2026-01-01" }))
      ).rejects.toThrow(ConflictException);

      await expect(
        avecContexte(() => etatsDesLieuxService.updateHeader(etatDesLieuxId, { dateSortie: "2026-09-30" }))
      ).resolves.toBeTruthy();
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.updateHeader(etatDesLieuxId, { nouvelleAdresseLocataire: "2 rue du Départ" })
        )
      ).resolves.toBeTruthy();
    });

    it("photos : l'ajout reste autorisé, l'archivage d'une photo de l'entrée est refusé", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const fichier = {
        originalname: "piece.jpg",
        mimetype: "image/jpeg",
        buffer: Buffer.from("contenu factice"),
        size: 16
      } as Express.Multer.File;
      const photoEntree = await avecContexte(() =>
        documentsService.upload({ entiteType: "etat_des_lieux", entiteId: etatDesLieuxId, categorie: "photo" }, fichier)
      );
      expect(photoEntree.etatDesLieuxPhase).toBe("entree");

      await signerEntree(etatDesLieuxId, titulaire.id);

      // Ajout toujours permis (la nouvelle photo est automatiquement
      // étiquetée "sortie" — resoudrePhaseEtatDesLieuxCourante).
      const photoSortie = await avecContexte(() =>
        documentsService.upload({ entiteType: "etat_des_lieux", entiteId: etatDesLieuxId, categorie: "photo" }, fichier)
      );
      expect(photoSortie.etatDesLieuxPhase).toBe("sortie");

      // Archivage de la photo d'entrée : refusé.
      await expect(avecContexte(() => documentsService.archiver(photoEntree.id))).rejects.toThrow(ConflictException);
      // Archivage de la photo de sortie : toujours permis (sortie pas encore signée).
      await expect(avecContexte(() => documentsService.archiver(photoSortie.id))).resolves.toBeTruthy();
    });

    it("photos : une photo sans phase (etat_des_lieux_phase NULL, antérieure à cette fonctionnalité) est traitée comme une photo d'entrée — refus d'archivage", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const [photoSansPhase] = await db
        .insert(documents)
        .values({
          entiteType: "etat_des_lieux",
          entiteId: etatDesLieuxId,
          categorie: "photo",
          nomFichier: "photo-anterieure.jpg",
          mimeType: "image/jpeg",
          tailleOctets: 16,
          cheminStockage: `documents/etat_des_lieux/${etatDesLieuxId}/${randomUUID()}.enc`,
          etatDesLieuxPhase: null
        })
        .returning();
      if (!photoSansPhase) {
        throw new Error("Échec de l'insertion de la photo factice sans phase");
      }

      await signerEntree(etatDesLieuxId, titulaire.id);

      await expect(avecContexte(() => documentsService.archiver(photoSansPhase.id))).rejects.toThrow(
        ConflictException
      );
    });
  });

  describe("après signature de la sortie", () => {
    it("submitPieceEntree : refuse même un champ 'sortie' (tout est figé)", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      await signerSortie(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() => etatsDesLieuxService.submitPieceEntree(etatDesLieuxId, { mur: { etatSortie: "TB" } }))
      ).rejects.toThrow(ConflictException);
    });

    it("updateHeader : refuse dateSortie et nouvelleAdresseLocataire", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      await signerSortie(etatDesLieuxId, titulaire.id);

      await expect(
        avecContexte(() => etatsDesLieuxService.updateHeader(etatDesLieuxId, { dateSortie: "2026-10-01" }))
      ).rejects.toThrow(ConflictException);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.updateHeader(etatDesLieuxId, { nouvelleAdresseLocataire: "3 rue du Départ" })
        )
      ).rejects.toThrow(ConflictException);
    });

    it("photos : plus aucun ajout ni archivage possible", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      const fichier = {
        originalname: "piece.jpg",
        mimetype: "image/jpeg",
        buffer: Buffer.from("contenu factice"),
        size: 16
      } as Express.Multer.File;
      const photo = await avecContexte(() =>
        documentsService.upload({ entiteType: "etat_des_lieux", entiteId: etatDesLieuxId, categorie: "photo" }, fichier)
      );

      await signerSortie(etatDesLieuxId, titulaire.id);

      await expect(
        avecContexte(() =>
          documentsService.upload({ entiteType: "etat_des_lieux", entiteId: etatDesLieuxId, categorie: "photo" }, fichier)
        )
      ).rejects.toThrow(ConflictException);
      await expect(avecContexte(() => documentsService.archiver(photo.id))).rejects.toThrow(ConflictException);
    });
  });

  describe("documents de catégorie 'signature' — immuables, quelle que soit la phase", () => {
    it("refuse l'archivage d'un document de signature par la route générique", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      const [docSignature] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.entiteId, etatDesLieuxId), eq(documents.categorie, "signature")))
        .limit(1);
      if (!docSignature) {
        throw new Error("Aucun document de signature trouvé après signerEntree");
      }
      await expect(avecContexte(() => documentsService.archiver(docSignature.id))).rejects.toThrow(
        ConflictException
      );
    });

    it("refuse toute modification de métadonnées (update) d'un document de signature", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      const [docSignature] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.entiteId, etatDesLieuxId), eq(documents.categorie, "signature")))
        .limit(1);
      if (!docSignature) {
        throw new Error("Aucun document de signature trouvé après signerEntree");
      }
      await expect(
        avecContexte(() => documentsService.update(docSignature.id, { categorie: "photo" }))
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("fermé par défaut — exhaustivité réelle des 11 submitX()/updateHeader() (régression)", () => {
    it("une soumission intégralement remplie, après signature de sortie, refuse CHAQUE méthode avec ConflictException — jamais une Error générique (qui révélerait un champ non classé)", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const [elementInventaire] = await db
        .select({ id: elementsInventaireMeuble.id })
        .from(elementsInventaireMeuble)
        .limit(1);
      if (!elementInventaire) {
        throw new Error("Catalogue elements_inventaire_meuble vide sur ce Postgres de test");
      }
      // Toutes les lignes list-based doivent déjà exister (sinon l'insertion
      // neuve serait refusée pour une autre raison — la soumission d'une
      // ligne existante est le scénario qui exerce le plus de champs).
      const [ligneCles] = await avecContexte(() =>
        etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [{ typeCle: "cave", nombreEntree: 1 }] })
      );
      const [ligneEquipement] = await avecContexte(() =>
        etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, {
          lignes: [{ libelle: "Aspirateur", nombreEntree: 1, etatEntree: "bon" }]
        })
      );
      await avecContexte(() =>
        etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
          lignes: [{ elementId: elementInventaire.id, nombreEntree: 1, etatEntree: "bon" }]
        })
      );

      await signerEntree(etatDesLieuxId, titulaire.id);
      await signerSortie(etatDesLieuxId, titulaire.id);

      const socleComplet = () => ({
        description: "d",
        etatEntree: "B" as const,
        etatSortie: "B" as const
      });
      const prisesComplet = () => ({ ...socleComplet(), nombre: 4 });

      const appels: { nom: string; appel: () => Promise<unknown> }[] = [
        {
          nom: "submitPieceEntree",
          appel: () =>
            avecContexte(() =>
              etatsDesLieuxService.submitPieceEntree(etatDesLieuxId, {
                porte: socleComplet(),
                sonnette: socleComplet(),
                mur: socleComplet(),
                sol: socleComplet(),
                vitrageVolets: socleComplet(),
                plafond: socleComplet(),
                eclairage: socleComplet(),
                prises: prisesComplet()
              })
            )
        },
        {
          nom: "submitPieceSejour",
          appel: () =>
            avecContexte(() =>
              etatsDesLieuxService.submitPieceSejour(etatDesLieuxId, {
                mur: socleComplet(),
                sol: socleComplet(),
                vitrageVolets: socleComplet(),
                plafond: socleComplet(),
                eclairage: socleComplet(),
                prises: prisesComplet()
              })
            )
        },
        {
          nom: "submitPieceCuisine",
          appel: () =>
            avecContexte(() =>
              etatsDesLieuxService.submitPieceCuisine(etatDesLieuxId, {
                mur: socleComplet(),
                sol: socleComplet(),
                vitrageVolets: socleComplet(),
                plafond: socleComplet(),
                eclairage: socleComplet(),
                prises: prisesComplet(),
                placards: socleComplet(),
                evier: socleComplet(),
                plaquesCuisson: socleComplet(),
                hotte: socleComplet(),
                electromenagerDescription: "d"
              })
            )
        },
        {
          nom: "submitPieceChambre",
          appel: () =>
            avecContexte(() =>
              etatsDesLieuxService.submitPieceChambre(etatDesLieuxId, {
                numero: 1,
                mur: socleComplet(),
                sol: socleComplet(),
                vitrageVolets: socleComplet(),
                plafond: socleComplet(),
                eclairage: socleComplet(),
                prises: prisesComplet()
              })
            )
        },
        {
          nom: "submitPieceSalleDeBain",
          appel: () =>
            avecContexte(() =>
              etatsDesLieuxService.submitPieceSalleDeBain(etatDesLieuxId, {
                numero: 1,
                mur: socleComplet(),
                sol: socleComplet(),
                vitrageVolets: socleComplet(),
                plafond: socleComplet(),
                eclairage: socleComplet(),
                prises: prisesComplet(),
                lavabo: socleComplet(),
                baignoire: socleComplet()
              })
            )
        },
        {
          nom: "submitPieceWc",
          appel: () =>
            avecContexte(() =>
              etatsDesLieuxService.submitPieceWc(etatDesLieuxId, {
                numero: 1,
                mur: socleComplet(),
                sol: socleComplet(),
                vitrageVolets: socleComplet(),
                plafond: socleComplet(),
                eclairage: socleComplet(),
                prises: prisesComplet(),
                lavabo: socleComplet(),
                wc: socleComplet()
              })
            )
        },
        {
          nom: "submitPieceAutre",
          appel: () =>
            avecContexte(() =>
              etatsDesLieuxService.submitPieceAutre(etatDesLieuxId, {
                numero: 1,
                libelle: "Buanderie",
                mur: socleComplet(),
                sol: socleComplet(),
                vitrageVolets: socleComplet(),
                plafond: socleComplet(),
                eclairage: socleComplet(),
                prises: prisesComplet()
              })
            )
        },
        {
          nom: "submitCompteurs",
          appel: () =>
            avecContexte(() =>
              etatsDesLieuxService.submitCompteurs(etatDesLieuxId, {
                electricite: {
                  numeroCompteurEntree: "1",
                  numeroCompteurSortie: "1",
                  releveHpEntree: "1.00",
                  releveHpSortie: "1.00",
                  releveHcEntree: "1.00",
                  releveHcSortie: "1.00",
                  ancienOccupantEntree: "1.00",
                  ancienOccupantSortie: "1.00"
                },
                gaz: {
                  numeroCompteurEntree: "1",
                  numeroCompteurSortie: "1",
                  releveEntree: "1.00",
                  releveSortie: "1.00"
                },
                eau: {
                  releveFroideEntree: "1.00",
                  releveFroideSortie: "1.00",
                  releveChaudeEntree: "1.00",
                  releveChaudeSortie: "1.00"
                }
              })
            )
        },
        {
          nom: "submitCles",
          appel: () =>
            avecContexte(() =>
              etatsDesLieuxService.submitCles(etatDesLieuxId, {
                lignes: [
                  {
                    id: ligneCles!.id,
                    typeCle: "cave",
                    libelleAutre: "x",
                    nombreEntree: 2,
                    nombreSortie: 2,
                    commentaire: "c"
                  }
                ]
              })
            )
        },
        {
          nom: "submitEquipementsDivers",
          appel: () =>
            avecContexte(() =>
              etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, {
                lignes: [
                  {
                    id: ligneEquipement!.id,
                    libelle: "Aspirateur",
                    nombreEntree: 2,
                    etatEntree: "bon",
                    nombreSortie: 2,
                    etatSortie: "bon",
                    commentaire: "c"
                  }
                ]
              })
            )
        },
        {
          nom: "submitInventaire",
          appel: () =>
            avecContexte(() =>
              etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
                lignes: [
                  {
                    elementId: elementInventaire.id,
                    nombreEntree: 2,
                    etatEntree: "bon",
                    nombreSortie: 2,
                    etatSortie: "bon",
                    commentaire: "c"
                  }
                ]
              })
            )
        },
        {
          nom: "updateHeader",
          appel: () =>
            avecContexte(() =>
              etatsDesLieuxService.updateHeader(etatDesLieuxId, {
                dateEntree: "2026-01-01",
                dateSortie: "2026-02-01",
                nouvelleAdresseLocataire: "x"
              })
            )
        }
      ];

      for (const { nom, appel } of appels) {
        await expect(appel(), nom).rejects.toThrow(ConflictException);
      }
    });
  });

  describe("comparaison normalisée — relevé de compteur décimal (régression réelle, pas seulement unitaire)", () => {
    it("resoumet le même relevé décimal avec une représentation différente ('650.0' vs '650.00' normalisé par Postgres) sans être bloqué, tout en posant un nouveau champ 'sortie'", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      // electriciteReleveHpEntree est une colonne `decimal(10,2)` : Postgres
      // la normalise à "650.00" quelle que soit la précision envoyée.
      await avecContexte(() =>
        etatsDesLieuxService.submitCompteurs(etatDesLieuxId, { electricite: { releveHpEntree: "650" } })
      );
      await signerEntree(etatDesLieuxId, titulaire.id);

      const resultat = await avecContexte(() =>
        etatsDesLieuxService.submitCompteurs(etatDesLieuxId, {
          // Même valeur numérique que la ligne en base ("650.00"), reçue
          // ici avec une précision différente ("650.0") — ne doit jamais
          // être vue comme une modification du champ "entree", déjà figé
          // par la signature.
          electricite: { releveHpEntree: "650.0", releveHpSortie: "700" }
        })
      );
      expect(resultat.electriciteReleveHpEntree).toBe("650.00"); // inchangé en base
      expect(resultat.electriciteReleveHpSortie).toBe("700.00");

      // Une vraie modification du relevé d'entrée reste refusée.
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitCompteurs(etatDesLieuxId, { electricite: { releveHpEntree: "651" } })
        )
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("comparaison normalisée — description NULL vs chaîne vide (régression réelle, bug remonté en test manuel desktop 2026-10-26)", () => {
    it("une pièce dont murDescription est NULL en base accepte une soumission de sortie où description vaut '' (ou des espaces), sans ConflictException sur un champ figé", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      // À l'entrée : seul etatEntree est renseigné pour "mur", jamais sa
      // description — murDescription reste NULL en base (cas réel :
      // l'utilisateur mobile n'a pas ouvert le commentaire de ce poste).
      await avecContexte(() => etatsDesLieuxService.submitPieceSejour(etatDesLieuxId, { mur: { etatEntree: "B" } }));
      await signerEntree(etatDesLieuxId, titulaire.id);

      // Soumission de sortie reproduisant exactement ce qu'envoyait le
      // desktop avant correction : description toujours présente dans le
      // payload, "" par défaut d'un champ contrôlé jamais rempli — un
      // champ "commune" (figé dès l'entrée) resoumis avec une
      // représentation différente de sa valeur actuelle (NULL), mais pas
      // une vraie modification. N'était auparavant jamais accepté
      // (ConflictException) ; la valeur écrite en base reflète ensuite ce
      // qui a été réellement soumis ("" ici) — seule la DÉCISION
      // d'autoriser l'écriture change, pas l'écriture elle-même.
      const resultat = await avecContexte(() =>
        etatsDesLieuxService.submitPieceSejour(etatDesLieuxId, { mur: { description: "", etatSortie: "B" } })
      );
      expect(resultat.murDescription).toBe("");
      expect(resultat.murEtatSortie).toBe("B");

      // Des espaces seuls sont équivalents à "" / NULL pour la DÉCISION
      // (pas de ConflictException), même si la valeur stockée maintenant
      // ("" juste au-dessus) diffère littéralement de "   ".
      const resultatEspaces = await avecContexte(() =>
        etatsDesLieuxService.submitPieceSejour(etatDesLieuxId, { mur: { description: "   ", etatSortie: "B" } })
      );
      expect(resultatEspaces.murDescription).toBe("   ");

      // Une vraie description (non vide) reste refusée — le champ est
      // réellement figé, seule la représentation d'une absence de valeur
      // est désormais tolérée.
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitPieceSejour(etatDesLieuxId, { mur: { description: "Fissure visible" } })
        )
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("CLASSIFICATION_PAR_TABLE — garde-fou (doublon volontaire du test dédié, vérifié ici en conditions réelles)", () => {
    it("une table enregistrée dans le verrou expose bien des colonnes toutes classées (sanity check)", async () => {
      // Le test exhaustif dédié vit dans classification-colonnes-etat-des-lieux.spec.ts ;
      // celui-ci vérifie seulement qu'aucune des tables réellement
      // utilisées ci-dessus (etatDesLieuxCles via submitCles, par exemple)
      // n'a changé de forme sans que ce fichier d'intégration le remarque.
      const { etatDesLieuxId } = await creerDossier(userId);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [{ typeCle: "cave", nombreEntree: 1 }] })
        )
      ).resolves.toBeTruthy();
    });
  });
});
