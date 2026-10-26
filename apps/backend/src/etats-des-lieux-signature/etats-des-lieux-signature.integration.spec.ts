import { randomUUID } from "crypto";
import { readdir, rm } from "fs/promises";
import os from "os";
import path from "path";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  etatDesLieuxSignature,
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
import { dateDuJourParis } from "../common/date-paris";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { DocumentsService } from "../documents/documents.service";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EtatsDesLieuxSignatureModule } from "./etats-des-lieux-signature.module";
import { EtatsDesLieuxSignatureService } from "./etats-des-lieux-signature.service";

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngTropVolumineuxBase64(): string {
  const enTete = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const remplissage = Buffer.alloc(512 * 1024 + 1, 0);
  return Buffer.concat([enTete, remplissage]).toString("base64");
}

describe("EtatsDesLieuxSignatureService — signature entrée/sortie (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-signatures-${randomUUID()}`);
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
        email: `signatures-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Signatures",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    return { organisationId: organisation.id, userId: user.id };
  }

  // `proprietaireUserId` paramétrable (jamais la fermeture sur le `userId`
  // de l'organisation de test par défaut) — nécessaire pour construire un
  // dossier appartenant à une AUTRE organisation dans le test de scoping
  // croisé ci-dessous. `avecLocataire=false` pour le test "bail sans
  // locataire actif" : aucun bail_locataires créé du tout.
  async function creerDossier(proprietaireUserId: string, options: { nombreColocataires?: number; avecLocataire?: boolean } = {}) {
    const { nombreColocataires = 0, avecLocataire = true } = options;
    const sci = await scisService.create(proprietaireUserId, {
      nom: "SCI Signatures Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(proprietaireUserId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Signatures Test",
      adresse: "1 rue des Signatures",
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
    if (avecLocataire) {
      await bailLocatairesService.create({ bailId: bail.id, locataireId: titulaire.id, role: "titulaire" });
    }

    const colocataires: { id: string; nom: string; prenom: string }[] = [];
    for (let i = 0; i < nombreColocataires; i++) {
      const colocataire = await locatairesService.create(proprietaireUserId, { nom: `Martin${i}`, prenom: `Alex${i}` });
      await bailLocatairesService.create({ bailId: bail.id, locataireId: colocataire.id, role: "colocataire" });
      colocataires.push(colocataire);
    }

    const etatDesLieux = await etatsDesLieuxService.create({ bailId: bail.id });
    return { etatDesLieuxId: etatDesLieux.id, titulaire, colocataires };
  }

  function dtoValide(locataireIds: string[], overrides: Record<string, unknown> = {}) {
    return {
      bailleur: { nomAffiche: "Jimmy Ettori", luEtApprouve: true, imagePng: PNG_1X1_BASE64 },
      locataires: locataireIds.map((locataireId) => ({ locataireId, luEtApprouve: true, imagePng: PNG_1X1_BASE64 })),
      ...overrides
    };
  }

  // Contexte "normal" (utilisateur + organisation de test) — la quasi-
  // totalité des tests l'utilisent. Les deux tests de scoping/sécurité
  // ci-dessous appellent `requestContextService.executerAvecContexte`
  // directement, avec un contexte délibérément différent.
  function avecContexte<T>(fn: () => T): T {
    return requestContextService.executerAvecContexte({ utilisateurId: userId, organisationId }, fn);
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

    const organisationEtUser = await creerOrganisationEtUtilisateur("Organisation Signatures Test");
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

  it("entreeSigneeParTous/sortieSigneeParTous valent false avant toute signature", async () => {
    const { etatDesLieuxId } = await creerDossier(userId);
    const resultat = await avecContexte(() => etatsDesLieuxService.findById(etatDesLieuxId));
    expect(resultat.entreeSigneeParTous).toBe(false);
    expect(resultat.sortieSigneeParTous).toBe(false);
  });

  describe("obtenirSignatairesAttendus (GET :id/signataires — écran mobile)", () => {
    it("propose le nom du bailleur (bien en SCI), la ville du logement, 1 locataire actif, aucune phase signée", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      const resultat = await avecContexte(() =>
        etatsDesLieuxSignatureService.obtenirSignatairesAttendus(etatDesLieuxId)
      );
      expect(resultat.villeLogement).toBe("Lyon");
      expect(resultat.bailleurNomPropose).toBe("SCI Signatures Test");
      expect(resultat.locataires).toEqual([{ locataireId: titulaire.id, nomAffiche: "Jean Dupont" }]);
      expect(resultat.entreeSignee).toBe(false);
      expect(resultat.sortieSignee).toBe(false);
    });

    it("liste bien les 2 locataires actifs d'une colocation, jamais un locataire archivé du bail", async () => {
      const { etatDesLieuxId, titulaire, colocataires } = await creerDossier(userId, { nombreColocataires: 1 });
      const resultat = await avecContexte(() =>
        etatsDesLieuxSignatureService.obtenirSignatairesAttendus(etatDesLieuxId)
      );
      expect(resultat.locataires.map((l) => l.locataireId).sort()).toEqual(
        [titulaire.id, colocataires[0]!.id].sort()
      );
    });

    it("entreeSignee/sortieSignee reflètent l'état réel après signature", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id])));
      const resultat = await avecContexte(() =>
        etatsDesLieuxSignatureService.obtenirSignatairesAttendus(etatDesLieuxId)
      );
      expect(resultat.entreeSignee).toBe(true);
      expect(resultat.sortieSignee).toBe(false);
    });

    it("refuse (404) un état des lieux d'une autre organisation, même règle que signerEntree", async () => {
      const autre = await creerOrganisationEtUtilisateur("Organisation Signatures Test — Autre (signataires)");
      const { etatDesLieuxId } = await creerDossier(autre.userId);
      await expect(
        avecContexte(() => etatsDesLieuxSignatureService.obtenirSignatairesAttendus(etatDesLieuxId))
      ).rejects.toThrow(NotFoundException);
    });

    it("refuse (404) en l'absence de tout contexte organisation", async () => {
      const { etatDesLieuxId } = await creerDossier(userId);
      await expect(
        requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
          etatsDesLieuxSignatureService.obtenirSignatairesAttendus(etatDesLieuxId)
        )
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("obtenirSignaturesPosees (GET :id/signatures — relecture desktop)", () => {
    it("tableau vide avant toute signature", async () => {
      const { etatDesLieuxId } = await creerDossier(userId);
      const resultat = await avecContexte(() => etatsDesLieuxSignatureService.obtenirSignaturesPosees(etatDesLieuxId));
      expect(resultat).toEqual([]);
    });

    it("après signature d'entrée seule : bailleur + locataire de la phase entrée uniquement, avec leur documentId", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id])));

      const resultat = await avecContexte(() => etatsDesLieuxSignatureService.obtenirSignaturesPosees(etatDesLieuxId));

      expect(resultat).toHaveLength(2);
      expect(resultat.every((s) => s.phase === "entree" && s.luEtApprouve === true)).toBe(true);
      expect(resultat.every((s) => typeof s.documentId === "string" && s.documentId.length > 0)).toBe(true);
      const bailleur = resultat.find((s) => s.role === "bailleur");
      expect(bailleur?.nomAffiche).toBe("Jimmy Ettori");
      expect(bailleur?.locataireId).toBeNull();
      const locataire = resultat.find((s) => s.role === "locataire");
      expect(locataire?.nomAffiche).toBe("Jean Dupont");
      expect(locataire?.locataireId).toBe(titulaire.id);
    });

    it("après entrée ET sortie signées : 4 lignes, 2 par phase", async () => {
      const { etatDesLieuxId, titulaire } = await creerDossier(userId);
      await avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id])));
      await avecContexte(() => etatsDesLieuxSignatureService.signerSortie(etatDesLieuxId, dtoValide([titulaire.id])));

      const resultat = await avecContexte(() => etatsDesLieuxSignatureService.obtenirSignaturesPosees(etatDesLieuxId));

      expect(resultat).toHaveLength(4);
      expect(resultat.filter((s) => s.phase === "entree")).toHaveLength(2);
      expect(resultat.filter((s) => s.phase === "sortie")).toHaveLength(2);
    });

    it("refuse (404) un état des lieux d'une autre organisation", async () => {
      const autre = await creerOrganisationEtUtilisateur("Organisation Signatures Test — Autre (posées)");
      const { etatDesLieuxId } = await creerDossier(autre.userId);
      await expect(
        avecContexte(() => etatsDesLieuxSignatureService.obtenirSignaturesPosees(etatDesLieuxId))
      ).rejects.toThrow(NotFoundException);
    });

    it("refuse (404) en l'absence de tout contexte organisation", async () => {
      const { etatDesLieuxId } = await creerDossier(userId);
      await expect(
        requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
          etatsDesLieuxSignatureService.obtenirSignaturesPosees(etatDesLieuxId)
        )
      ).rejects.toThrow(NotFoundException);
    });
  });

  it("signerEntree : pose dateEntree (date de Paris) + lieuEntree (défaut ville du logement), crée les signatures et les documents attendus", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);

    const resultat = await avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id])));

    expect(resultat.dateEntree).toBe(dateDuJourParis());
    expect(resultat.lieuEntree).toBe("Lyon"); // ville du bien, aucun lieu fourni dans le DTO
    expect(resultat.entreeSigneeParTous).toBe(true);
    expect(resultat.sortieSigneeParTous).toBe(false);

    const signatures = await db
      .select()
      .from(etatDesLieuxSignature)
      .where(eq(etatDesLieuxSignature.etatDesLieuxId, etatDesLieuxId));
    expect(signatures).toHaveLength(2);
    expect(signatures.map((s) => s.role).sort()).toEqual(["bailleur", "locataire"]);
    expect(signatures.every((s) => s.phase === "entree" && s.luEtApprouve === true)).toBe(true);

    const lignesDocuments = await db
      .select()
      .from(documents)
      .where(and(eq(documents.entiteType, "etat_des_lieux"), eq(documents.entiteId, etatDesLieuxId)));
    expect(lignesDocuments).toHaveLength(2);
    expect(lignesDocuments.every((d) => d.categorie === "signature" && d.etatDesLieuxPhase === "entree")).toBe(true);
  });

  it("signerEntree : respecte le lieu fourni plutôt que la ville par défaut", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);
    const resultat = await avecContexte(() =>
      etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id], { lieu: "Marseille" }))
    );
    expect(resultat.lieuEntree).toBe("Marseille");
  });

  it("rejette si « Lu et approuvé » n'est pas coché pour le bailleur", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);
    const dto = dtoValide([titulaire.id]);
    dto.bailleur.luEtApprouve = false;
    await expect(avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dto))).rejects.toThrow(
      BadRequestException
    );
  });

  it("rejette si « Lu et approuvé » n'est pas coché pour un locataire", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);
    const dto = dtoValide([titulaire.id]);
    dto.locataires[0]!.luEtApprouve = false;
    await expect(avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dto))).rejects.toThrow(
      BadRequestException
    );
  });

  it("rejette un nom de bailleur vide après suppression des espaces", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);
    const dto = dtoValide([titulaire.id]);
    dto.bailleur.nomAffiche = "   ";
    await expect(avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dto))).rejects.toThrow(
      BadRequestException
    );
  });

  it("rejette la signature d'un bail sans aucun locataire actif (état des lieux contradictoire)", async () => {
    const { etatDesLieuxId } = await creerDossier(userId, { avecLocataire: false });
    await expect(avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([])))).rejects.toThrow(
      BadRequestException
    );
  });

  it("rejette une signature manquante (colocataire actif non inclus dans la requête)", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId, { nombreColocataires: 1 });
    await expect(
      // Seul le titulaire est signé, le colocataire actif manque.
      avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id])))
    ).rejects.toThrow(BadRequestException);
  });

  it("rejette un signataire inattendu (locataireId qui n'est pas partie active à ce bail)", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);
    const autreLocataire = await locatairesService.create(userId, { nom: "Étranger", prenom: "Au Bail" });
    await expect(
      avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id, autreLocataire.id])))
    ).rejects.toThrow(BadRequestException);
  });

  it("rejette une image dépassant 512 Ko", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);
    const dto = dtoValide([titulaire.id]);
    dto.bailleur.imagePng = pngTropVolumineuxBase64();
    await expect(avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dto))).rejects.toThrow(
      BadRequestException
    );
  });

  it("rejette une seconde signature de la même phase (déjà signée)", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);
    await avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id])));
    await expect(
      avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id])))
    ).rejects.toThrow(ConflictException);
  });

  it("rejette la signature de sortie avant celle de l'entrée", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);
    await expect(
      avecContexte(() => etatsDesLieuxSignatureService.signerSortie(etatDesLieuxId, dtoValide([titulaire.id])))
    ).rejects.toThrow(ConflictException);
  });

  it("parcours complet entrée puis sortie : les deux indicateurs passent à true, dateSortie (date de Paris)/lieuSortie posés", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);
    await avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id])));

    const resultat = await avecContexte(() =>
      etatsDesLieuxSignatureService.signerSortie(etatDesLieuxId, dtoValide([titulaire.id], { lieu: "Lyon" }))
    );

    expect(resultat.dateSortie).toBe(dateDuJourParis());
    expect(resultat.lieuSortie).toBe("Lyon");
    expect(resultat.entreeSigneeParTous).toBe(true);
    expect(resultat.sortieSigneeParTous).toBe(true);

    const signatures = await db
      .select()
      .from(etatDesLieuxSignature)
      .where(eq(etatDesLieuxSignature.etatDesLieuxId, etatDesLieuxId));
    expect(signatures).toHaveLength(4); // 2 (entrée) + 2 (sortie)
  });

  it("upload de photo d'état des lieux : phase 'entree' tant que l'entrée n'est pas signée, 'sortie' ensuite", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);
    const fichier = {
      originalname: "piece.jpg",
      mimetype: "image/jpeg",
      buffer: Buffer.from("contenu factice"),
      size: 16
    } as Express.Multer.File;

    const photoAvantEntree = await avecContexte(() =>
      documentsService.upload({ entiteType: "etat_des_lieux", entiteId: etatDesLieuxId, categorie: "photo" }, fichier)
    );
    expect(photoAvantEntree.etatDesLieuxPhase).toBe("entree");

    await avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id])));

    const photoApresEntree = await avecContexte(() =>
      documentsService.upload({ entiteType: "etat_des_lieux", entiteId: etatDesLieuxId, categorie: "photo" }, fichier)
    );
    expect(photoApresEntree.etatDesLieuxPhase).toBe("sortie");
  });

  it("upload de photo : phase reste 'entree' même si dateEntree est posée à la main sans aucune signature (cas état des lieux papier)", async () => {
    const { etatDesLieuxId } = await creerDossier(userId);
    // Même geste que le bouton "Terminer" du parcours mobile actuel (avant
    // ce chantier) ou une correction manuelle côté desktop : pose
    // dateEntree directement, sans jamais passer par
    // EtatsDesLieuxSignatureService — aucune signature n'existe.
    await avecContexte(() => etatsDesLieuxService.updateHeader(etatDesLieuxId, { dateEntree: "2026-01-01" }));

    const fichier = {
      originalname: "piece.jpg",
      mimetype: "image/jpeg",
      buffer: Buffer.from("contenu factice"),
      size: 16
    } as Express.Multer.File;
    const photo = await avecContexte(() =>
      documentsService.upload({ entiteType: "etat_des_lieux", entiteId: etatDesLieuxId, categorie: "photo" }, fichier)
    );
    // Si la phase dépendait encore de date_entree, elle vaudrait "sortie"
    // ici — c'est précisément le bug que ce test empêche de réintroduire.
    expect(photo.etatDesLieuxPhase).toBe("entree");
  });

  it("refuse (404) un état des lieux appartenant à une autre organisation", async () => {
    const autre = await creerOrganisationEtUtilisateur("Organisation Signatures Test — Autre");
    const { etatDesLieuxId, titulaire } = await creerDossier(autre.userId);

    // Contexte de l'organisation de test "normale" (celle du beforeEach),
    // qui ne possède pas cet état des lieux.
    await expect(
      avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id])))
    ).rejects.toThrow(NotFoundException);
  });

  it("refuse (404) en l'absence de tout contexte organisation, même pour un état des lieux qui existe réellement — refuse en cas de doute, n'accorde jamais l'accès", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);
    await expect(
      requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
        etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id]))
      )
    ).rejects.toThrow(NotFoundException);
  });

  it("aucun blob orphelin ne reste sur le stockage, et aucune signature bailleur n'est jamais enregistrée sans l'ensemble des signatures locataires de la même phase (atomicité de la transaction unique)", async () => {
    const { etatDesLieuxId, titulaire } = await creerDossier(userId);

    // Pré-insertion directe (hors service, contournement délibéré) d'une
    // signature LOCATAIRE déjà posée pour la phase "entree" — le
    // pré-contrôle applicatif de signerEntree (chargerContexte) ne
    // vérifie que la présence d'une signature BAILLEUR pour savoir si la
    // phase est déjà signée, donc il ne détecte pas cette incohérence :
    // signerEntree écrit bel et bien ses blobs, insère bel et bien la
    // ligne bailleur (premier élément de la boucle), puis échoue
    // seulement à l'insertion SQL de la ligne locataire, sur la
    // contrainte etat_des_lieux_signature_locataire_phase_unique.
    // Reproduit fidèlement, et de façon déterministe (sans vraie
    // concurrence), le même échec qu'une course entre deux requêtes
    // simultanées — et prouve que même la ligne bailleur, insérée EN
    // PREMIER dans la boucle et donc déjà en base au moment de l'échec,
    // ne survit pas : tout ou rien, dans la même transaction.
    const [documentFactice] = await db
      .insert(documents)
      .values({
        entiteType: "etat_des_lieux",
        entiteId: etatDesLieuxId,
        categorie: "signature",
        nomFichier: "signature-locataire-entree.png",
        mimeType: "image/png",
        tailleOctets: 10,
        cheminStockage: `documents/etat_des_lieux/${etatDesLieuxId}/${randomUUID()}.enc`,
        etatDesLieuxPhase: "entree"
      })
      .returning();
    if (!documentFactice) {
      throw new Error("Échec de l'insertion du document factice");
    }
    await db.insert(etatDesLieuxSignature).values({
      etatDesLieuxId,
      phase: "entree",
      role: "locataire",
      locataireId: titulaire.id,
      nomAffiche: "Jean Dupont",
      documentId: documentFactice.id,
      luEtApprouve: true,
      signeLe: new Date()
    });

    await expect(
      avecContexte(() => etatsDesLieuxSignatureService.signerEntree(etatDesLieuxId, dtoValide([titulaire.id])))
    ).rejects.toThrow(ConflictException);

    // Invariant base de données : pas de ligne bailleur pour la phase
    // "entree", malgré la tentative — seule la ligne locataire factice
    // pré-insérée (avant l'appel) existe encore.
    const signaturesApresEchec = await db
      .select()
      .from(etatDesLieuxSignature)
      .where(eq(etatDesLieuxSignature.etatDesLieuxId, etatDesLieuxId));
    expect(signaturesApresEchec).toHaveLength(1);
    expect(signaturesApresEchec[0]?.role).toBe("locataire");

    // Le document factice ci-dessus n'a jamais été écrit sur disque (seule
    // la ligne SQL a été insérée directement, sans passer par le
    // storage) — le dossier ne doit donc contenir AUCUN fichier après
    // l'échec : ni le blob du bailleur, ni celui du locataire écrits par
    // la tentative avortée.
    const dossierStockage = path.join(storageDirTest, "documents", "etat_des_lieux", etatDesLieuxId);
    const fichiersSurDisque = await readdir(dossierStockage).catch(() => []);
    expect(fichiersSurDisque).toHaveLength(0);
  });
});
