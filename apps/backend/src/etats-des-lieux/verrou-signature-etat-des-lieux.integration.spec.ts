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
  elementsInventaireMeuble,
  organisations,
  utilisateurs,
  type Database
} from "db";
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

    it("submitCles : interdit la création d'une ligne neuve (typeCle, commune, est forcément posé)", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await signerEntree(etatDesLieuxId, titulaire.id);
      await expect(
        avecContexte(() =>
          etatsDesLieuxService.submitCles(etatDesLieuxId, { lignes: [{ typeCle: "cave", nombreEntree: 1 }] })
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
