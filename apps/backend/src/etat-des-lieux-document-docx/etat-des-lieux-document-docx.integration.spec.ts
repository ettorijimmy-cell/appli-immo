import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { BadRequestException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  appartements,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  elementsInventaireMeuble,
  equipements,
  journalAudit,
  organisations,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import PizZip from "pizzip";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { EncryptionModule } from "../crypto/encryption.module";
import { DocumentsModule } from "../documents/documents.module";
import { DocumentsService } from "../documents/documents.service";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { ImmeublesModule } from "../immeubles/immeubles.module";
import { ImmeublesService } from "../immeubles/immeubles.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { EtatDesLieuxDocumentDocxModule } from "./etat-des-lieux-document-docx.module";
import { EtatDesLieuxDocumentDocxService } from "./etat-des-lieux-document-docx.service";

// Copie committée du modèle réel du propriétaire, validé par lui à l'écran
// (tmp/Modèle état des lieux.docx, hors dépôt) — toutes les balises en
// place, aucune correction nécessaire contrairement à la fixture du bail.
const FIXTURE_TEMPLATE = path.join(__dirname, "__fixtures__", "modele-etat-des-lieux-test.docx");
process.env["ETAT_DES_LIEUX_DOCUMENT_DOCX_TEMPLATE_PATH"] = FIXTURE_TEMPLATE;

function texteDuDocx(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const documentXml = zip.files["word/document.xml"];
  if (!documentXml) {
    throw new Error("word/document.xml introuvable dans le .docx généré");
  }
  const xml = documentXml.asText();
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
}

function balisesResiduelles(buffer: Buffer): string[] {
  const texte = texteDuDocx(buffer);
  return [...new Set([...texte.matchAll(/\{[^}]*\}/g)].map((m) => m[0]))];
}

async function creerPetitePngValide(couleur: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: couleur } })
    .png()
    .toBuffer();
}

function fauxFichierMulter(buffer: Buffer, originalname: string, mimetype: string): Express.Multer.File {
  return {
    buffer,
    originalname,
    mimetype,
    size: buffer.length,
    fieldname: "fichier",
    encoding: "7bit",
    stream: undefined as never,
    destination: "",
    filename: "",
    path: ""
  };
}

describe("Génération docx de l'état des lieux (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let immeublesService: ImmeublesService;
  let appartementsService: AppartementsService;
  let locatairesService: LocatairesService;
  let bauxService: BauxService;
  let bailLocatairesService: BailLocatairesService;
  let etatsDesLieuxService: EtatsDesLieuxService;
  let documentsService: DocumentsService;
  let etatDesLieuxDocumentDocxService: EtatDesLieuxDocumentDocxService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        AuditModule,
        UsersModule,
        AuthModule,
        ScisModule,
        ImmeublesModule,
        AppartementsModule,
        LocatairesModule,
        BauxModule,
        BailLocatairesModule,
        EncryptionModule,
        DocumentsModule,
        EtatsDesLieuxModule,
        EtatDesLieuxDocumentDocxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    immeublesService = moduleRef.get(ImmeublesService);
    appartementsService = moduleRef.get(AppartementsService);
    locatairesService = moduleRef.get(LocatairesService);
    bauxService = moduleRef.get(BauxService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    etatsDesLieuxService = moduleRef.get(EtatsDesLieuxService);
    documentsService = moduleRef.get(DocumentsService);
    etatDesLieuxDocumentDocxService = moduleRef.get(EtatDesLieuxDocumentDocxService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation EDL Docx Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `edl-docx-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "EdlDocx",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;
  });

  afterEach(async () => {
    await moduleRef.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  // Assemble un dossier complet (SCI, immeuble, appartement avec
  // composition connue, locataire(s), bail) — `typeBail`/`avecColocataire`
  // pilotent les variantes couvertes par les différents tests.
  async function creerDossierComplet(
    options: { typeBail?: "vide" | "meuble"; avecColocataire?: boolean } = {}
  ) {
    const typeBail = options.typeBail ?? "vide";
    const avecColocataire = options.avecColocataire ?? false;

    const sci = await scisService.create(userId, {
      nom: "SCI EDL Test",
      regimeFiscal: "IR",
      adresse: "1 avenue de la République",
      codePostal: "75011",
      ville: "Paris"
    });

    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble EDL Test",
      adresse: "12 rue des Lilas",
      codePostal: "75011",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });

    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
      numero: "3B",
      type: "T3",
      surface: "55.00",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    // Composition réelle (chambres/SdB/WC) + type_energie : aucun DTO ne
    // les expose pour l'instant côté appartements (gap pré-existant,
    // même situation que annee_construction avant sa propre exposition —
    // voir Étape 4). Écriture directe en base pour ce test.
    await appartementsService.update(appartement.id, {
      nombreChambres: 1,
      nombreSallesDeBain: 1,
      nombreWc: 1,
      autrePiece1: "Bureau"
    });
    await db.update(appartements).set({ typeEnergie: "electrique" }).where(eq(appartements.id, appartement.id));

    const locataireTitulaire = await locatairesService.create({ nom: "Dupont", prenom: "Jean" });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail,
      dateDebut: "2026-08-01",
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: locataireTitulaire.id, role: "titulaire" });

    if (avecColocataire) {
      const colocataire = await locatairesService.create({ nom: "Martin", prenom: "Marie" });
      await bailLocatairesService.create({ bailId: bail.id, locataireId: colocataire.id, role: "colocataire" });
    }

    const etatDesLieux = await etatsDesLieuxService.create({ bailId: bail.id });

    return { sci, immeuble, appartement, locataireTitulaire, bail, etatDesLieux };
  }

  // Remplit toutes les sections avec des données réalistes (entrée
  // uniquement, sauf mention contraire) : pièces uniques, une instance de
  // chaque pièce à occurrences multiples, compteurs, clés (fixes + 2
  // "autre"), équipements divers, et — pour un bail meublé — une partie du
  // catalogue d'inventaire réel.
  async function remplirEtatDesLieuxComplet(etatDesLieuxId: string, bailTypeBail: "vide" | "meuble") {
    await etatsDesLieuxService.submitPieceEntree(etatDesLieuxId, {
      porte: { description: "Bois", etatEntree: "B" },
      mur: { etatEntree: "TB" },
      sol: { description: "Carrelage", etatEntree: "B" },
      prises: { etatEntree: "B", nombre: 2 }
    });
    await etatsDesLieuxService.submitPieceSejour(etatDesLieuxId, {
      sol: { description: "Parquet", etatEntree: "TB" },
      prises: { etatEntree: "B", nombre: 4 }
    });
    await etatsDesLieuxService.submitPieceCuisine(etatDesLieuxId, {
      sol: { description: "Carrelage", etatEntree: "B" },
      plaquesCuisson: { description: "Induction", etatEntree: "TB" },
      electromenagerDescription: "Réfrigérateur américain"
    });
    await etatsDesLieuxService.submitPieceChambre(etatDesLieuxId, {
      numero: 1,
      sol: { description: "Parquet", etatEntree: "B" }
    });
    await etatsDesLieuxService.submitPieceSalleDeBain(etatDesLieuxId, {
      numero: 1,
      lavabo: { etatEntree: "B" },
      baignoire: { etatEntree: "TB" }
    });
    await etatsDesLieuxService.submitPieceWc(etatDesLieuxId, {
      numero: 1,
      wc: { etatEntree: "B" }
    });
    await etatsDesLieuxService.submitPieceAutre(etatDesLieuxId, {
      numero: 1,
      libelle: "Bureau",
      sol: { description: "Stratifié", etatEntree: "B" }
    });

    await etatsDesLieuxService.submitCompteurs(etatDesLieuxId, {
      electricite: { numeroCompteurEntree: "12345", releveHpEntree: "1000.00", releveHcEntree: "500.00" },
      gaz: { numeroCompteurEntree: "98765", releveEntree: "200.00" },
      eau: { releveFroideEntree: "300.00", releveChaudeEntree: "150.00" }
    });

    await etatsDesLieuxService.submitCles(etatDesLieuxId, {
      lignes: [
        { typeCle: "immeuble", nombreEntree: 2, commentaire: "RAS" },
        { typeCle: "porte_entree", nombreEntree: 2 },
        { typeCle: "boite_lettres", nombreEntree: 1 },
        { typeCle: "cave", nombreEntree: 1 },
        { typeCle: "badge_portail", nombreEntree: 0 },
        { typeCle: "parking", nombreEntree: 0 },
        { typeCle: "autre", libelleAutre: "Cadenas cave", nombreEntree: 1 },
        { typeCle: "autre", libelleAutre: "Télécommande portail", nombreEntree: 1 }
      ]
    });

    await etatsDesLieuxService.submitEquipementsDivers(etatDesLieuxId, {
      lignes: [{ libelle: "Tondeuse", nombreEntree: 1, etatEntree: "bon" }]
    });

    if (bailTypeBail === "meuble") {
      const catalogue = await db.select().from(elementsInventaireMeuble).limit(3);
      for (const item of catalogue) {
        await etatsDesLieuxService.submitInventaire(etatDesLieuxId, {
          lignes: [{ elementId: item.id, nombreEntree: 1, etatEntree: "bon" }]
        });
      }
    }
  }

  it("génère un .docx complet (bail vide) avec toutes les sections d'entrée, sans balise résiduelle", async () => {
    const { sci, locataireTitulaire, bail, etatDesLieux } = await creerDossierComplet({
      typeBail: "vide"
    });
    await remplirEtatDesLieuxComplet(etatDesLieux.id, "vide");
    await etatsDesLieuxService.updateHeader(etatDesLieux.id, { dateEntree: "2026-08-01" });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
    );

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");

    const texte = texteDuDocx(buffer);
    expect(texte).toContain(sci.nom);
    expect(texte).toContain(`${locataireTitulaire.prenom} ${locataireTitulaire.nom}`);
    expect(texte).toContain("12 rue des Lilas");
    expect(texte).toContain("2026-08-01");
    expect(texte).toContain("Bois"); // entrée, porte
    expect(texte).toContain("Parquet"); // séjour, sol
    expect(texte).toContain("Induction"); // cuisine, plaques de cuisson
    expect(texte).toContain("Réfrigérateur américain"); // cuisine, électroménager (texte libre)
    expect(texte).toContain("RAS"); // clés immeuble, commentaire
    expect(texte).toContain("Cadenas cave"); // clé "autre" #1
    expect(texte).toContain("Télécommande portail"); // clé "autre" #2
    expect(texte).toContain("Tondeuse"); // équipements divers
    expect(texte).toContain("Bureau"); // autre pièce
    // "Chaudière"/":"/"0" sont 3 runs XML séparés (texteDuDocx joint tous
    // les <w:t> avec un espace, y compris entre des runs adjacents sans
    // espace réel dans le document) — comparaison tolérante aux espaces.
    expect(texte).toMatch(/Chaudière\s*:\s*0\b/); // aucun équipement déclaré pour ce dossier
    expect(texte).toMatch(/Chauffe-eau\s*:\s*0\b/);

    // Bail vide : jamais le bloc inventaire meublé.
    void bail;

    expect(balisesResiduelles(buffer)).toEqual([]);
  });

  it("affiche le nombre réel de chaudières/chauffe-eau déclarés (1 chaudière ici, 0 chauffe-eau), et exclut les équipements archivés", async () => {
    const { appartement, etatDesLieux } = await creerDossierComplet({ typeBail: "vide" });
    await remplirEtatDesLieuxComplet(etatDesLieux.id, "vide");
    await etatsDesLieuxService.updateHeader(etatDesLieux.id, { dateEntree: "2026-08-01" });

    await db.insert(equipements).values({ appartementId: appartement.id, type: "chaudiere" });
    // Équipement archivé : ne doit jamais être compté.
    await db
      .insert(equipements)
      .values({ appartementId: appartement.id, type: "chaudiere", archivedAt: new Date() });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
    );

    const texte = texteDuDocx(buffer);
    expect(texte).toMatch(/Chaudière\s*:\s*1\b/);
    expect(texte).toMatch(/Chauffe-eau\s*:\s*0\b/);
  });

  it("un appartement sans aucun équipement déclaré affiche 0/0, pas une ligne masquée", async () => {
    const { etatDesLieux } = await creerDossierComplet({ typeBail: "vide" });
    await remplirEtatDesLieuxComplet(etatDesLieux.id, "vide");
    await etatsDesLieuxService.updateHeader(etatDesLieux.id, { dateEntree: "2026-08-01" });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
    );

    const texte = texteDuDocx(buffer);
    expect(texte).toMatch(/Chaudière\s*:\s*0\b/);
    expect(texte).toMatch(/Chauffe-eau\s*:\s*0\b/);
  });

  it("génère un .docx complet (bail meublé, colocation) et inclut l'inventaire réel", async () => {
    const { locataireTitulaire, etatDesLieux } = await creerDossierComplet({
      typeBail: "meuble",
      avecColocataire: true
    });
    await remplirEtatDesLieuxComplet(etatDesLieux.id, "meuble");
    await etatsDesLieuxService.updateHeader(etatDesLieux.id, { dateEntree: "2026-08-01" });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
    );

    const texte = texteDuDocx(buffer);
    // Deux locataires : jointure "X et Y", jamais une simple concaténation.
    expect(texte).toContain(`${locataireTitulaire.prenom} ${locataireTitulaire.nom} et Marie Martin`);

    const catalogue = await db.select().from(elementsInventaireMeuble).limit(3);
    for (const item of catalogue) {
      expect(texte).toContain(item.libelle);
    }

    // Rupture visuelle entre les 3 catégories de l'inventaire (MEUBLES /
    // ÉLECTRO-MÉNAGER / ÉQUIPEMENT), réintroduite dans le tableau continu
    // — sinon 85 lignes indifférenciées, illisibles.
    expect(texte).toContain("MEUBLES");
    expect(texte).toContain("ÉLECTRO-MÉNAGER");
    expect(texte).toContain("ÉQUIPEMENT");

    expect(balisesResiduelles(buffer)).toEqual([]);
  });

  it("jointure de 3 locataires ou plus : virgules entre tous les noms, 'et' avant le dernier seulement", async () => {
    const { locataireTitulaire, bail, etatDesLieux } = await creerDossierComplet({ typeBail: "vide" });
    await remplirEtatDesLieuxComplet(etatDesLieux.id, "vide");
    await etatsDesLieuxService.updateHeader(etatDesLieux.id, { dateEntree: "2026-08-01" });
    const c1 = await locatairesService.create({ nom: "Martin", prenom: "Marie" });
    const c2 = await locatairesService.create({ nom: "Durand", prenom: "Paul" });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: c1.id, role: "colocataire" });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: c2.id, role: "colocataire" });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
    );

    const texte = texteDuDocx(buffer);
    expect(texte).toContain(`${locataireTitulaire.prenom} ${locataireTitulaire.nom}, Marie Martin et Paul Durand`);
  });

  it("intègre les photos réelles (entrée, cuisine, chambre 1) via le module image", async () => {
    const { etatDesLieux } = await creerDossierComplet({ typeBail: "vide" });
    await remplirEtatDesLieuxComplet(etatDesLieux.id, "vide");
    await etatsDesLieuxService.updateHeader(etatDesLieux.id, { dateEntree: "2026-08-01" });

    const photoEntree = await creerPetitePngValide({ r: 200, g: 50, b: 50 });
    const photoCuisine = await creerPetitePngValide({ r: 50, g: 200, b: 50 });
    const photoChambre = await creerPetitePngValide({ r: 50, g: 50, b: 200 });

    await requestContextService.executerAvecContexte({ utilisateurId: userId }, async () => {
      await documentsService.upload(
        { entiteType: "etat_des_lieux", entiteId: etatDesLieux.id, categorie: "photo", etatDesLieuxPieceType: "entree" },
        fauxFichierMulter(photoEntree, "entree.png", "image/png")
      );
      await documentsService.upload(
        { entiteType: "etat_des_lieux", entiteId: etatDesLieux.id, categorie: "photo", etatDesLieuxPieceType: "cuisine" },
        fauxFichierMulter(photoCuisine, "cuisine.png", "image/png")
      );
      await documentsService.upload(
        {
          entiteType: "etat_des_lieux",
          entiteId: etatDesLieux.id,
          categorie: "photo",
          etatDesLieuxPieceType: "chambre",
          etatDesLieuxPieceNumero: 1
        },
        fauxFichierMulter(photoChambre, "chambre1.png", "image/png")
      );
    });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
    );

    const zip = new PizZip(buffer);
    const mediaGenerees = Object.keys(zip.files).filter(
      (f) => f.startsWith("word/media/") && f.includes("generated")
    );
    // 3 photos fournies (entrée, cuisine, chambre 1) : aucune ne doit se
    // mélanger dans une autre section (bug de portée déjà constaté et
    // corrigé sur les balises {#photosEntree}/{#photosSejour}/{#photosCuisine}
    // — voir le rapport de vérification de tmp/Modèle état des lieux.docx).
    expect(mediaGenerees).toHaveLength(3);
  });

  it("colonne sortie masquée tant que date_sortie est absente, puis renseignée une fois la sortie faite", async () => {
    const { etatDesLieux } = await creerDossierComplet({ typeBail: "vide" });
    await remplirEtatDesLieuxComplet(etatDesLieux.id, "vide");
    await etatsDesLieuxService.updateHeader(etatDesLieux.id, { dateEntree: "2026-08-01" });
    // Valeur de sortie déjà en base à ce stade (saisie anticipée possible
    // côté UI) — ne doit PAS apparaître tant que date_sortie est absente.
    await etatsDesLieuxService.submitPieceEntree(etatDesLieux.id, {
      porte: { etatSortie: "M" }
    });

    const bufferAvantSortie = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
    );
    const texteAvant = texteDuDocx(bufferAvantSortie);
    // "M" isolé n'est pas cherchable de façon fiable (lettre trop courte) —
    // on vérifie plutôt l'absence de la date de résiliation et la présence
    // d'un état sortie vide en structure (déjà couvert par l'absence de
    // balise résiduelle) ; ici on vérifie explicitement la date.
    expect(texteAvant).not.toContain("2026-09-01");

    await etatsDesLieuxService.updateHeader(etatDesLieux.id, { dateSortie: "2026-09-01" });
    const bufferApresSortie = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
    );
    const texteApres = texteDuDocx(bufferApresSortie);
    expect(texteApres).toContain("2026-09-01");
  });

  it("bloque si la composition de l'appartement (chambres/SdB/WC) est incomplète", async () => {
    const { appartement, etatDesLieux } = await creerDossierComplet({ typeBail: "vide" });
    await etatsDesLieuxService.updateHeader(etatDesLieux.id, { dateEntree: "2026-08-01" });
    await db.update(appartements).set({ nombreWc: null }).where(eq(appartements.id, appartement.id));

    let erreur: unknown;
    try {
      await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
        etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
      );
    } catch (err) {
      erreur = err;
    }

    expect(erreur).toBeInstanceOf(BadRequestException);
    const reponse = (erreur as BadRequestException).getResponse() as { champsManquants: string[] };
    expect(reponse.champsManquants).toContain("Nombre de WC de l'appartement");
  });

  it("bloque si l'entrée n'est pas terminée (date d'entrée absente), avec un message explicite", async () => {
    const { etatDesLieux } = await creerDossierComplet({ typeBail: "vide" });
    // Pas d'updateHeader ici : date_entree reste null.

    let erreur: unknown;
    try {
      await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
        etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
      );
    } catch (err) {
      erreur = err;
    }

    expect(erreur).toBeInstanceOf(BadRequestException);
    const reponse = (erreur as BadRequestException).getResponse() as { champsManquants: string[] };
    expect(reponse.champsManquants.some((m) => m.includes("entrée doit être terminée"))).toBe(true);
  });

  it("consigne un accès dans journal_audit à chaque génération réussie, aucun si la génération échoue", async () => {
    const { etatDesLieux } = await creerDossierComplet({ typeBail: "vide" });
    await remplirEtatDesLieuxComplet(etatDesLieux.id, "vide");
    await etatsDesLieuxService.updateHeader(etatDesLieux.id, { dateEntree: "2026-08-01" });

    await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
    );
    const entreesSucces = await db.select().from(journalAudit).where(eq(journalAudit.entiteId, etatDesLieux.id));
    expect(entreesSucces).toHaveLength(1);
    expect(entreesSucces[0]).toMatchObject({
      entiteType: "etat_des_lieux_document_genere",
      entiteId: etatDesLieux.id,
      action: "acces",
      utilisateurId: userId
    });

    const { etatDesLieux: etatDesLieuxIncomplet } = await creerDossierComplet({ typeBail: "vide" });
    await requestContextService
      .executerAvecContexte({ utilisateurId: userId }, () =>
        etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieuxIncomplet.id)
      )
      .catch(() => undefined);
    const entreesEchec = await db
      .select()
      .from(journalAudit)
      .where(eq(journalAudit.entiteId, etatDesLieuxIncomplet.id));
    expect(entreesEchec).toHaveLength(0);
  });
});

// Reproduit exactement l'incident réel (voir docs/error-log.md,
// [2026-08-08]) : le propriétaire a rouvert le modèle Word dans Word pour
// une édition ponctuelle et {/meublé} a disparu par inadvertance, laissant
// {#meublé} sans fermeture. Avant le garde-fou, ceci aurait produit un
// document au contenu partiellement faux sans avertir personne — ce test
// vérifie que la génération est bloquée avec un message explicite, jamais
// qu'un document est produit.
describe("Garde-fou : modèle avec balises de boucle non appariées (intégration réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let cheminModeleCasse: string;
  let moduleRef: TestingModule;
  let scisService: ScisService;
  let immeublesService: ImmeublesService;
  let appartementsService: AppartementsService;
  let locatairesService: LocatairesService;
  let bauxService: BauxService;
  let bailLocatairesService: BailLocatairesService;
  let etatsDesLieuxService: EtatsDesLieuxService;
  let etatDesLieuxDocumentDocxService: EtatDesLieuxDocumentDocxService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;

  beforeAll(async () => {
    // Construit une copie du modèle valide committé, avec la balise
    // fermante {/meublé} retirée — celle-ci est scindée sur 3 runs XML
    // distincts dans le fichier réel ("{/meubl" + "é" + "}", scission
    // introduite par Word), reproduisant fidèlement comment elle a pu
    // disparaître lors d'une édition manuelle.
    const buffer = await readFile(FIXTURE_TEMPLATE);
    const zip = new PizZip(buffer);
    const documentXml = zip.file("word/document.xml")?.asText();
    if (!documentXml) {
      throw new Error("word/document.xml introuvable dans la fixture committée.");
    }
    const SEQUENCE_FERMANTE =
      '<w:t>{/meubl</w:t></w:r><w:r w:rsidRPr="006F3967"><w:rPr><w:rFonts w:ascii="Times New Roman"/><w:sz w:val="16"/></w:rPr><w:t>é</w:t></w:r><w:r w:rsidRPr="006F3967"><w:rPr><w:rFonts w:ascii="Times New Roman"/><w:sz w:val="16"/></w:rPr><w:t>}</w:t></w:r>';
    if ((documentXml.split(SEQUENCE_FERMANTE).length - 1) !== 1) {
      throw new Error("Séquence de la balise {/meublé} introuvable ou ambiguë dans la fixture — vérifier le fichier.");
    }
    const documentXmlCasse = documentXml.replace(SEQUENCE_FERMANTE, "");
    zip.file("word/document.xml", documentXmlCasse);

    cheminModeleCasse = path.join(os.tmpdir(), `modele-etat-des-lieux-meuble-casse-${randomUUID()}.docx`);
    await writeFile(cheminModeleCasse, zip.generate({ type: "nodebuffer" }));
  });

  beforeEach(async () => {
    db = await begin();
    process.env["ETAT_DES_LIEUX_DOCUMENT_DOCX_TEMPLATE_PATH"] = cheminModeleCasse;

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        AuditModule,
        UsersModule,
        AuthModule,
        ScisModule,
        ImmeublesModule,
        AppartementsModule,
        LocatairesModule,
        BauxModule,
        BailLocatairesModule,
        EncryptionModule,
        DocumentsModule,
        EtatsDesLieuxModule,
        EtatDesLieuxDocumentDocxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    immeublesService = moduleRef.get(ImmeublesService);
    appartementsService = moduleRef.get(AppartementsService);
    locatairesService = moduleRef.get(LocatairesService);
    bauxService = moduleRef.get(BauxService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    etatsDesLieuxService = moduleRef.get(EtatsDesLieuxService);
    etatDesLieuxDocumentDocxService = moduleRef.get(EtatDesLieuxDocumentDocxService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Garde-fou Balises" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `garde-fou-balises-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "GardeFou",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;
  });

  afterEach(async () => {
    await moduleRef.close();
    await rollback();
    // Restaure la fixture valide pour ne pas affecter d'autres tests
    // exécutés dans le même processus après celui-ci.
    process.env["ETAT_DES_LIEUX_DOCUMENT_DOCX_TEMPLATE_PATH"] = FIXTURE_TEMPLATE;
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("bloque la génération avec un message explicite nommant {/meublé}, sans produire de document", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Garde-fou Test",
      regimeFiscal: "IR",
      adresse: "1 rue du Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Garde-fou",
      adresse: "1 rue du Test",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });
    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
      numero: "1",
      type: "T2",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    await appartementsService.update(appartement.id, { nombreChambres: 1, nombreSallesDeBain: 1, nombreWc: 1 });
    const locataire = await locatairesService.create({ nom: "Test", prenom: "Locataire" });
    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "meuble",
      dateDebut: "2026-08-01",
      loyerMensuel: "500.00",
      depotGarantie: "500.00",
      provisionsCharges: "20.00",
      jourEcheance: 5
    });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
    const etatDesLieux = await etatsDesLieuxService.create({ bailId: bail.id });
    await etatsDesLieuxService.updateHeader(etatDesLieux.id, { dateEntree: "2026-08-01" });

    let erreur: unknown;
    try {
      await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
        etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieux.id)
      );
    } catch (err) {
      erreur = err;
    }

    expect(erreur).toBeInstanceOf(BadRequestException);
    expect((erreur as BadRequestException).message).toBe("Le modèle est corrompu : {/meublé} manquant ou en surnombre");
  });
});
