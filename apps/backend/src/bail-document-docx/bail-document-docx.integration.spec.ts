import { randomUUID } from "crypto";
import path from "path";
import { ConfigModule } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  appartements,
  bailLocataires,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  immeubles,
  journalAudit,
  organisations,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import PizZip from "pizzip";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { GarantsModule } from "../garants/garants.module";
import { GarantsService } from "../garants/garants.service";
import { ImmeublesModule } from "../immeubles/immeubles.module";
import { ImmeublesService } from "../immeubles/immeubles.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { BailDocumentDocxModule } from "./bail-document-docx.module";
import { BailDocumentDocxService } from "./bail-document-docx.service";

// Fixture committée : copie corrigée du modèle réel du propriétaire
// (tmp/Modèle bail.docx, hors dépôt) — les 3 balises cassées ("]" au lieu
// de "}") corrigées, et les blocs conditionnels clauseResolutoireAvant/
// clauseResolutoireApres/servitude ajoutés (absents du fichier réel à ce
// jour, voir docs/backlog.md). Le vrai fichier du propriétaire nécessite
// encore ces deux corrections avant de pouvoir être utilisé tel quel.
const FIXTURE_TEMPLATE = path.join(__dirname, "__fixtures__", "modele-bail-test.docx");
process.env["BAIL_DOCUMENT_DOCX_TEMPLATE_PATH"] = FIXTURE_TEMPLATE;

function texteDuDocx(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const documentXml = zip.files["word/document.xml"];
  if (!documentXml) {
    throw new Error("word/document.xml introuvable dans le .docx généré");
  }
  const xml = documentXml.asText();
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
}

describe("Génération docx du bail (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let immeublesService: ImmeublesService;
  let appartementsService: AppartementsService;
  let locatairesService: LocatairesService;
  let garantsService: GarantsService;
  let bauxService: BauxService;
  let bailLocatairesService: BailLocatairesService;
  let bailDocumentDocxService: BailDocumentDocxService;
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
        GarantsModule,
        BauxModule,
        BailLocatairesModule,
        BailDocumentDocxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    immeublesService = moduleRef.get(ImmeublesService);
    appartementsService = moduleRef.get(AppartementsService);
    locatairesService = moduleRef.get(LocatairesService);
    garantsService = moduleRef.get(GarantsService);
    bauxService = moduleRef.get(BauxService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    bailDocumentDocxService = moduleRef.get(BailDocumentDocxService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Bail Docx Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `bail-docx-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "BailDocx",
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

  // Assemble un dossier complet (SCI, immeuble, appartement, locataire,
  // bail, garant) avec TOUS les champs requis par validerCompletudeGenerationBail
  // renseignés — `surcharges` permet à un test de rendre un champ précis
  // manquant ou de changer le régime, sans dupliquer tout le montage.
  async function creerDossierComplet(options: { dateDebut?: string; avecGarant?: boolean } = {}) {
    const dateDebut = options.dateDebut ?? "2026-07-01";
    const avecGarant = options.avecGarant ?? true;

    const sci = await scisService.create(userId, { nom: "SCI Docx Test", regimeFiscal: "IR" });
    await scisService.update(sci.id, { telephone: "0555555555", estFamiliale: true });

    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Docx Test",
      adresse: "17 avenue du Test",
      codePostal: "19100",
      ville: "Brive"
    });
    // annee_construction n'est exposée par aucun DTO à ce jour (gap
    // pré-existant, voir le rapport de ce chantier) — écriture directe en
    // base pour ce test, en attendant que le formulaire immeuble l'expose.
    await db.update(immeubles).set({ anneeConstruction: 1998 }).where(eq(immeubles.id, immeuble.id));

    const appartement = await appartementsService.create({
      immeubleId: immeuble.id,
      numero: "rdc",
      type: "T3",
      surface: "60.00",
      loyerReference: "650.00"
    });
    await appartementsService.update(appartement.id, {
      equipementCuisine: "Plaques, four, réfrigérateur",
      dependancesAnnexes: "Cave"
    });

    const locataire = await locatairesService.create({ nom: "Devos", prenom: "Ilan" });
    await locatairesService.update(locataire.id, {
      adresse: "1 rue du Locataire",
      codePostal: "19100",
      ville: "Brive",
      dateNaissance: "1990-05-12",
      telephone: "0611111111",
      email: "ilan.devos@example.com"
    });

    const bail = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut,
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });

    await bailLocatairesService.create({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });

    if (avecGarant) {
      await garantsService.create({
        bailId: bail.id,
        nom: "Durand",
        prenom: "Claire",
        typeGarantie: "personne_physique",
        dateNaissance: "1965-03-20",
        lieuNaissance: "Lyon",
        nationalite: "Française"
      });
    }

    return { sci, immeuble, appartement, locataire, bail };
  }

  it("génère un .docx complet quand toutes les données requises sont présentes (régime avant le 1er octobre 2026)", async () => {
    const { bail, sci, locataire } = await creerDossierComplet({ dateDebut: "2026-07-01" });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    expect(buffer.length).toBeGreaterThan(0);
    // Signature d'un fichier zip (tout .docx en est un) : "PK".
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");

    const texte = texteDuDocx(buffer);
    expect(texte).toContain(sci.nom);
    expect(texte).toContain(`${locataire.prenom} ${locataire.nom}`);
    expect(texte).toContain("650.00");

    // Régime avant le 1er octobre 2026 : "deux mois", jamais "six semaines".
    expect(texte).toContain("deux mois");
    expect(texte).not.toContain("six semaines");
    expect(texte).not.toContain("Servitude de résidence principale");

    // Durée légale dérivée de est_familiale=true (SCI familiale, 3 ans) :
    // date de fin = 2026-07-01 + 36 mois = 2029-07-01.
    expect(texte).toContain("2029-07-01");
  });

  it("régime à partir du 1er octobre 2026 avec servitude explicitement demandée", async () => {
    const { bail } = await creerDossierComplet({ dateDebut: "2026-10-01" });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, { servitudeResidencePrincipale: true })
    );

    const texte = texteDuDocx(buffer);
    expect(texte).toContain("six semaines");
    expect(texte).not.toContain("deux mois après la date d'un commandement");
    expect(texte).toContain("Servitude de résidence principale");
  });

  it("ne mentionne jamais la servitude si le paramètre n'est pas explicitement fourni, même après le 1er octobre 2026", async () => {
    const { bail } = await creerDossierComplet({ dateDebut: "2026-10-01" });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    const texte = texteDuDocx(buffer);
    expect(texte).not.toContain("Servitude de résidence principale");
  });

  it("bloque avec la liste COMPLÈTE des champs manquants, pas seulement le premier trouvé", async () => {
    const { immeuble, appartement, bail } = await creerDossierComplet();

    // Rend PLUSIEURS champs manquants à la fois, sur des entités
    // différentes. equipementCuisine/anneeConstruction ne peuvent pas être
    // remis à null via l'API (un DTO optionnel omis signifie "ne pas
    // modifier", pas "effacer") : écriture directe en base pour simuler
    // une donnée jamais renseignée.
    await db.update(immeubles).set({ anneeConstruction: null }).where(eq(immeubles.id, immeuble.id));
    await db.update(appartements).set({ equipementCuisine: null }).where(eq(appartements.id, appartement.id));

    let erreur: unknown;
    try {
      await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
        bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
      );
    } catch (err) {
      erreur = err;
    }

    expect(erreur).toBeInstanceOf(BadRequestException);
    const reponse = (erreur as BadRequestException).getResponse() as { champsManquants: string[] };
    expect(reponse.champsManquants).toContain("Année de construction de l'immeuble");
    expect(reponse.champsManquants).toContain("Équipement de la cuisine");
    // La génération ne doit produire AUCUN document partiel.
  });

  it("un bail sans garant génère normalement, sans jamais signaler de champ garant manquant", async () => {
    const { bail } = await creerDossierComplet({ avecGarant: false });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    expect(buffer.length).toBeGreaterThan(0);
  });

  it("bloque si un garant rattaché a des champs manquants (date/lieu de naissance, nationalité)", async () => {
    const { bail } = await creerDossierComplet({ avecGarant: false });
    await garantsService.create({
      bailId: bail.id,
      nom: "Incomplet",
      prenom: "Garant",
      typeGarantie: "personne_physique"
      // dateNaissance/lieuNaissance/nationalite volontairement absents
    });

    let erreur: unknown;
    try {
      await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
        bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
      );
    } catch (err) {
      erreur = err;
    }

    expect(erreur).toBeInstanceOf(BadRequestException);
    const reponse = (erreur as BadRequestException).getResponse() as { champsManquants: string[] };
    expect(reponse.champsManquants).toContain("Garant — date de naissance");
    expect(reponse.champsManquants).toContain("Garant — lieu de naissance");
    expect(reponse.champsManquants).toContain("Garant — nationalité");
  });

  it("consigne un accès dans journal_audit à chaque génération réussie", async () => {
    const { bail } = await creerDossierComplet();

    await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    const entrees = await db.select().from(journalAudit).where(eq(journalAudit.entiteId, bail.id));
    expect(entrees).toHaveLength(1);
    expect(entrees[0]).toMatchObject({
      entiteType: "bail_document_genere",
      entiteId: bail.id,
      action: "acces",
      utilisateurId: userId
    });
  });

  it("ne consigne rien dans journal_audit si la génération échoue (champs manquants)", async () => {
    const { appartement, bail } = await creerDossierComplet();
    await db.update(appartements).set({ equipementCuisine: null }).where(eq(appartements.id, appartement.id));

    await requestContextService
      .executerAvecContexte({ utilisateurId: userId }, () =>
        bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
      )
      .catch(() => undefined);

    const entrees = await db.select().from(journalAudit).where(eq(journalAudit.entiteId, bail.id));
    expect(entrees).toHaveLength(0);
  });

  it("ne référence jamais bailLocataires archivés (colocataire retiré) dans le document", async () => {
    const { bail, locataire } = await creerDossierComplet();
    const colocataire = await locatairesService.create({ nom: "Retiré", prenom: "Ancien" });
    await locatairesService.update(colocataire.id, { adresse: "X", codePostal: "X", ville: "X" });
    const lien = await bailLocatairesService.create({
      bailId: bail.id,
      locataireId: colocataire.id,
      role: "colocataire"
    });
    await bailLocatairesService.archive(lien.id);

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    const texte = texteDuDocx(buffer);
    expect(texte).not.toContain("Retiré");
    expect(texte).toContain(locataire.nom);

    const liensEnBase = await db.select().from(bailLocataires).where(eq(bailLocataires.bailId, bail.id));
    expect(liensEnBase).toHaveLength(2);
  });
});
