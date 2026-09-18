import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
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
import { GarantsModule } from "../garants/garants.module";
import { GarantsService } from "../garants/garants.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { PaiementsModule } from "../paiements/paiements.module";
import { PaiementsService } from "../paiements/paiements.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { TableauDeBordModule } from "./tableau-de-bord.module";
import { TableauDeBordService } from "./tableau-de-bord.service";

function fichierTest(contenu: string, nom: string): Express.Multer.File {
  return {
    originalname: nom,
    mimetype: "application/pdf",
    buffer: Buffer.from(contenu, "utf8"),
    size: Buffer.byteLength(contenu, "utf8")
  } as Express.Multer.File;
}

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  appartement1Id: string;
  appartement2Id: string | null;
  appartement3Id: string;
  bail1Id: string;
  bail3Id: string;
  locataireId: string;
  garantId: string;
  loyerAppart1: string;
  loyerAppart3: string;
  nbDiagnosticsExpires: number;
}

// Sous-commit 4d (chantier scoping multi-organisation, 2026-09-18) :
// TableauDeBordService, 7 méthodes, ne filtrait jusqu'ici jamais par
// organisation. Chaque organisation reçoit ici des montants ET des
// effectifs DÉLIBÉRÉMENT DIFFÉRENTS (pas seulement "présents") : une
// fuite de scoping se traduirait par un total identique aux deux
// organisations, un total fusionné (somme des deux), ou un compte
// d'appartements vacants incohérent — jamais seulement "vide vs non
// vide", ce qu'un test moins soigné pourrait laisser passer.
describe("TableauDeBordService — scoping par organisation, 7 méthodes (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-tdb-scoping-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let locatairesService: LocatairesService;
  let bailLocatairesService: BailLocatairesService;
  let garantsService: GarantsService;
  let paiementsService: PaiementsService;
  let versementsService: VersementsService;
  let documentsService: DocumentsService;
  let tableauDeBordService: TableauDeBordService;
  let requestContextService: RequestContextService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(
    suffixe: string,
    params: { loyerAppart1: string; provisionsCharges1: string; loyerAppart3: string; avecAppartementVacant: boolean; nbDiagnosticsExpires: number }
  ): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation TDB Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `tdb-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `TdbScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    const userId = user.id;

    const sci = await scisService.create(userId, {
      nom: `SCI TDB Scoping ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: `Immeuble TDB Scoping ${suffixe}`,
      adresse: "1 rue du Tableau de Bord",
      codePostal: "75001",
      ville: "Paris",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
    });

    // Appartement 1 : bail actif, une échéance impayée, un diagnostic
    // expiré, un versement de revenu — sert getEnTete/getCartes/
    // getRevenusLocatifs/getChecklistDocumentaire/getSynthese.
    const appartement1 = await appartementsService.create({
      bienId: bien.id,
      numero: "1",
      type: "T2",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      loyerReference: params.loyerAppart1
    });
    const bail1 = await bauxService.create({
      appartementId: appartement1.id,
      typeBail: "vide",
      dateDebut: "2026-06-01",
      loyerMensuel: params.loyerAppart1,
      provisionsCharges: params.provisionsCharges1,
      jourEcheance: 5
    });
    await bauxService.activer(bail1.id);
    // L'échéance de loyer auto-générée à l'activation reçoit un versement
    // (revenu de la période pour getRevenusLocatifs/getSynthese) ; une
    // seconde échéance, créée explicitement, reste impayée (pour
    // getCartes).
    const [echeanceGeneree] = (await paiementsService.findAll(bail1.id)).filter((p) => p.type === "loyer");
    if (!echeanceGeneree) {
      throw new Error("Échéance de loyer auto-générée introuvable après activation");
    }
    // Versement couvrant l'INTÉGRALITÉ de l'échéance (loyer + provisions,
    // voir calculerMontantEcheanceLoyer) — pour que loyerNet/provisions
    // (calculerLoyerNetRecuEcheance/calculerProvisionsRecuesEcheance,
    // proportionnelles au montant reçu) donnent des valeurs exactes et
    // prévisibles, pas un versement partiel qui répartirait le manque à
    // gagner sur les deux composantes.
    const montantEcheanceComplete = (
      Number(params.loyerAppart1) + Number(params.provisionsCharges1)
    ).toFixed(2);
    await versementsService.ajouter({
      paiementId: echeanceGeneree.id,
      montant: montantEcheanceComplete,
      mode: "virement",
      dateVersement: "2026-06-05"
    });
    await paiementsService.create({
      bailId: bail1.id,
      type: "loyer",
      montant: params.loyerAppart1,
      dateEcheance: "2026-01-01"
    });

    for (let i = 0; i < params.nbDiagnosticsExpires; i += 1) {
      await documentsService.upload(
        { entiteType: "appartement", entiteId: appartement1.id, categorie: "dpe", dateExpiration: "2020-01-01" },
        fichierTest(`diagnostic expiré ${suffixe} ${i}`, `dpe-${suffixe}-${i}.pdf`)
      );
    }

    const locataire = await locatairesService.create(userId, { nom: "Dupont", prenom: `Alice${suffixe}` });
    await bailLocatairesService.create({ bailId: bail1.id, locataireId: locataire.id, role: "titulaire" });
    const garant = await garantsService.create({
      bailId: bail1.id,
      nom: "Durand",
      prenom: `Claire${suffixe}`,
      typeGarantie: "personne_physique"
    });

    // Appartement 2 : vacant, aucun bail — sert getEnTete (biensVacants).
    // Effectif volontairement différent entre les deux organisations
    // (présent seulement pour A) pour que le compte diffère réellement,
    // pas seulement les montants.
    let appartement2Id: string | null = null;
    if (params.avecAppartementVacant) {
      const appartement2 = await appartementsService.create({
        bienId: bien.id,
        numero: "2",
        type: "T1",
        nombrePiecesPrincipales: 1,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });
      appartement2Id = appartement2.id;
    }

    // Appartement 3 : bail activé puis résilié avec trop-perçu — sert
    // getRemboursementsEnAttente.
    const appartement3 = await appartementsService.create({
      bienId: bien.id,
      numero: "3",
      type: "T1",
      nombrePiecesPrincipales: 1,
      modeChauffage: "individuel",
      modeEauChaude: "individuel",
      loyerReference: params.loyerAppart3
    });
    const bail3 = await bauxService.create({
      appartementId: appartement3.id,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: params.loyerAppart3,
      jourEcheance: 5
    });
    await bauxService.activer(bail3.id);
    const [echeanceBail3] = (await paiementsService.findAll(bail3.id)).filter((p) => p.type === "loyer");
    if (!echeanceBail3) {
      throw new Error("Échéance de loyer auto-générée introuvable après activation (bail3)");
    }
    // Versement couvrant l'intégralité du mois — la résiliation à
    // mi-mois (le 15) proratise le montant dû, créant un trop-perçu réel.
    await versementsService.ajouter({
      paiementId: echeanceBail3.id,
      montant: params.loyerAppart3,
      mode: "virement",
      dateVersement: "2026-01-01"
    });
    await bauxService.resilier(bail3.id, { dateFin: "2026-01-15" });

    return {
      organisationId: organisation.id,
      userId,
      appartement1Id: appartement1.id,
      appartement2Id,
      appartement3Id: appartement3.id,
      bail1Id: bail1.id,
      bail3Id: bail3.id,
      locataireId: locataire.id,
      garantId: garant.id,
      loyerAppart1: params.loyerAppart1,
      loyerAppart3: params.loyerAppart3,
      nbDiagnosticsExpires: params.nbDiagnosticsExpires
    };
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
        BauxModule,
        LocatairesModule,
        BailLocatairesModule,
        GarantsModule,
        PaiementsModule,
        VersementsModule,
        DocumentsModule,
        TableauDeBordModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    locatairesService = moduleRef.get(LocatairesService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    garantsService = moduleRef.get(GarantsService);
    paiementsService = moduleRef.get(PaiementsService);
    versementsService = moduleRef.get(VersementsService);
    documentsService = moduleRef.get(DocumentsService);
    tableauDeBordService = moduleRef.get(TableauDeBordService);
    requestContextService = moduleRef.get(RequestContextService);

    orgA = await creerFixtureOrganisation("A", {
      loyerAppart1: "800.00",
      provisionsCharges1: "100.00",
      loyerAppart3: "500.00",
      avecAppartementVacant: true,
      nbDiagnosticsExpires: 1
    });
    orgB = await creerFixtureOrganisation("B", {
      loyerAppart1: "1200.00",
      provisionsCharges1: "150.00",
      loyerAppart3: "600.00",
      avecAppartementVacant: false,
      nbDiagnosticsExpires: 2
    });
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  function contexteOrgA<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgA.userId, organisationId: orgA.organisationId }, fn);
  }
  function contexteOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgB.userId, organisationId: orgB.organisationId }, fn);
  }

  it("getEnTete scope par organisation — biensVacants et valeurLocativeTotale diffèrent réellement entre A et B", async () => {
    const enTeteA = await contexteOrgA(() => tableauDeBordService.getEnTete());
    const enTeteB = await contexteOrgB(() => tableauDeBordService.getEnTete());

    // Org A : appartement1 loué (800) ; appartement2 vacant ; appartement3
    // repassé vacant par la résiliation (calculerStatutAppartementApres
    // Resiliation) — biensVacants = 2, valeurLocativeTotale ne compte que
    // les LOUÉS (appartement1 seul).
    expect(enTeteA.biensLoues).toBe(1);
    expect(enTeteA.biensVacants).toBe(2);
    expect(enTeteA.valeurLocativeTotale).toBe("800.00");

    // Org B : appartement1 loué (1200) ; pas d'appartement2 ; appartement3
    // vacant après résiliation — biensVacants = 1.
    expect(enTeteB.biensLoues).toBe(1);
    expect(enTeteB.biensVacants).toBe(1);
    expect(enTeteB.valeurLocativeTotale).toBe("1200.00");

    // Ni fusion (biensLoues additionnés vaudrait 4, jamais 2) ni confusion.
    expect(enTeteA.valeurLocativeTotale).not.toBe(enTeteB.valeurLocativeTotale);
    expect(enTeteA.biensVacants).not.toBe(enTeteB.biensVacants);
  });

  it("getCartes scope par organisation — impayes.montantRestant et documentsExpires diffèrent réellement entre A et B", async () => {
    const cartesA = await contexteOrgA(() => tableauDeBordService.getCartes());
    const cartesB = await contexteOrgB(() => tableauDeBordService.getCartes());

    expect(cartesA.impayes.nombre).toBe(1);
    expect(cartesA.impayes.montantRestant).toBe("800.00");
    expect(cartesA.documentsExpires).toBe(1);

    expect(cartesB.impayes.nombre).toBe(1);
    expect(cartesB.impayes.montantRestant).toBe("1200.00");
    expect(cartesB.documentsExpires).toBe(2);

    // Si le scoping fuitait, montantRestant serait la somme (2000.00) et
    // documentsExpires la somme (3) — jamais les valeurs propres à chaque
    // organisation observées ci-dessus.
    expect(cartesA.impayes.montantRestant).not.toBe(cartesB.impayes.montantRestant);
    expect(cartesA.documentsExpires).not.toBe(cartesB.documentsExpires);
  });

  it("getRevenusLocatifs scope par organisation — totalLoyerNet et totalProvisions diffèrent réellement entre A et B", async () => {
    const revenusA = await contexteOrgA(() => tableauDeBordService.getRevenusLocatifs("2026-06-01", "2026-06-30"));
    const revenusB = await contexteOrgB(() => tableauDeBordService.getRevenusLocatifs("2026-06-01", "2026-06-30"));

    // Versement couvrant l'échéance complète (loyer + provisions) : la
    // répartition proportionnelle (calculerLoyerNetRecuEcheance/
    // calculerProvisionsRecuesEcheance) redonne exactement loyerMensuel et
    // provisionsCharges d'origine, sans reste.
    expect(revenusA.totalLoyerNet).toBe("800.00");
    expect(revenusA.totalProvisions).toBe("100.00");

    expect(revenusB.totalLoyerNet).toBe("1200.00");
    expect(revenusB.totalProvisions).toBe("150.00");

    expect(revenusA.totalLoyerNet).not.toBe(revenusB.totalLoyerNet);
    expect(revenusA.totalProvisions).not.toBe(revenusB.totalProvisions);
  });

  it("getRemboursementsEnAttente scope par organisation — le trop-perçu détecté diffère réellement entre A et B", async () => {
    const resultatsA = await contexteOrgA(() => tableauDeBordService.getRemboursementsEnAttente());
    const resultatsB = await contexteOrgB(() => tableauDeBordService.getRemboursementsEnAttente());

    expect(resultatsA).toHaveLength(1);
    expect(resultatsA[0]?.bailId).toBe(orgA.bail3Id);
    expect(resultatsB).toHaveLength(1);
    expect(resultatsB[0]?.bailId).toBe(orgB.bail3Id);

    // Org A : loyer 500 sur 31 jours, occupé du 1er au 15 (15 jours) —
    // prorata < montant plein, versement = montant plein => trop-perçu > 0.
    // Org B : loyer 600, même schéma de dates — trop-perçu proportionnellement
    // différent (600 vs 500 de base), jamais égal ni fusionné.
    expect(resultatsA[0]?.montant).not.toBe(resultatsB[0]?.montant);
    expect(resultatsA.map((r) => r.bailId)).not.toContain(orgB.bail3Id);
    expect(resultatsB.map((r) => r.bailId)).not.toContain(orgA.bail3Id);
  });

  it("getChecklistDocumentaire scope par organisation — chaque organisation ne voit que ses propres entités incomplètes", async () => {
    const checklistA = await contexteOrgA(() => tableauDeBordService.getChecklistDocumentaire());
    const checklistB = await contexteOrgB(() => tableauDeBordService.getChecklistDocumentaire());

    // appartement1 (org A) a bien un diagnostic dpe, mais toujours aucun
    // elec_gaz/crep_plomb/erp : reste incomplet, donc listé.
    expect(checklistA.appartements.map((a) => a.appartementId)).toContain(orgA.appartement1Id);
    expect(checklistA.appartements.map((a) => a.appartementId)).not.toContain(orgB.appartement1Id);
    expect(checklistA.locataires.map((l) => l.locataireId)).toContain(orgA.locataireId);
    expect(checklistA.locataires.map((l) => l.locataireId)).not.toContain(orgB.locataireId);
    expect(checklistA.garants.map((g) => g.garantId)).toContain(orgA.garantId);
    expect(checklistA.garants.map((g) => g.garantId)).not.toContain(orgB.garantId);

    expect(checklistB.appartements.map((a) => a.appartementId)).toContain(orgB.appartement1Id);
    expect(checklistB.appartements.map((a) => a.appartementId)).not.toContain(orgA.appartement1Id);
    expect(checklistB.locataires.map((l) => l.locataireId)).toContain(orgB.locataireId);
    expect(checklistB.locataires.map((l) => l.locataireId)).not.toContain(orgA.locataireId);
    expect(checklistB.garants.map((g) => g.garantId)).toContain(orgB.garantId);
    expect(checklistB.garants.map((g) => g.garantId)).not.toContain(orgA.garantId);
  });

  it("getCompletudeDocumentaire vérifie l'appartenance à l'organisation — 404 sur un entiteId d'une autre organisation", async () => {
    // appartement : chemin par jointure (bien.organisationId).
    await expect(
      contexteOrgB(() => tableauDeBordService.getCompletudeDocumentaire("appartement", orgA.appartement1Id))
    ).rejects.toThrow(NotFoundException);
    // Depuis sa propre organisation, la même méthode fonctionne normalement.
    await expect(
      contexteOrgA(() => tableauDeBordService.getCompletudeDocumentaire("appartement", orgA.appartement1Id))
    ).resolves.toBeDefined();

    // locataire : chemin par colonne organisationId propre.
    await expect(
      contexteOrgB(() => tableauDeBordService.getCompletudeDocumentaire("locataire", orgA.locataireId))
    ).rejects.toThrow(NotFoundException);
    await expect(
      contexteOrgA(() => tableauDeBordService.getCompletudeDocumentaire("locataire", orgA.locataireId))
    ).resolves.toBeDefined();

    // garant : même principe, colonne organisationId propre.
    await expect(
      contexteOrgB(() => tableauDeBordService.getCompletudeDocumentaire("garant", orgA.garantId))
    ).rejects.toThrow(NotFoundException);
    await expect(
      contexteOrgA(() => tableauDeBordService.getCompletudeDocumentaire("garant", orgA.garantId))
    ).resolves.toBeDefined();
  });

  it("getSynthese scope par organisation — revenuNet par SCI diffère réellement entre A et B, aucune fuite d'existence", async () => {
    const syntheseA = await contexteOrgA(() => tableauDeBordService.getSynthese("2026-06-01", "2026-06-30"));
    const syntheseB = await contexteOrgB(() => tableauDeBordService.getSynthese("2026-06-01", "2026-06-30"));

    expect(syntheseA).toHaveLength(1);
    expect(syntheseB).toHaveLength(1);

    const sciA = syntheseA[0];
    const sciB = syntheseB[0];
    // Org A : un seul appartement génère du revenu sur juin (appartement1,
    // versement complet -> loyerNet = loyerMensuel exact = 800) ;
    // appartement3 n'a aucun versement en juin (résilié en janvier) —
    // revenu net du bien = 800.
    expect(sciA?.revenuNet).toBe("800.00");
    expect(sciB?.revenuNet).toBe("1200.00");
    expect(sciA?.revenuNet).not.toBe(sciB?.revenuNet);

    // Aucune fuite d'existence : le nom de la SCI de l'autre organisation
    // n'apparaît jamais dans la réponse (pas de ligne à revenu 0 fantôme).
    const nomsA = syntheseA.map((s) => s.nom);
    const nomsB = syntheseB.map((s) => s.nom);
    expect(nomsA.some((nom) => nom.includes("Scoping B"))).toBe(false);
    expect(nomsB.some((nom) => nom.includes("Scoping A"))).toBe(false);
  });
});
