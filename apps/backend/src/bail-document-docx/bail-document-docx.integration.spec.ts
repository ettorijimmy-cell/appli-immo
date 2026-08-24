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
  documents,
  immeubles,
  indicesIrl,
  journalAudit,
  organisations,
  paiements,
  utilisateurs,
  type Database
} from "db";
import { and, eq } from "drizzle-orm";
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
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { BailDocumentDocxModule } from "./bail-document-docx.module";
import { BailDocumentDocxService } from "./bail-document-docx.service";

// Fixture committée : copie corrigée du modèle réel du propriétaire
// (tmp/Modèle bail.docx, hors dépôt) — les 3 balises cassées ("]" au lieu
// de "}") corrigées, et les blocs conditionnels clauseResolutoireAvant/
// clauseResolutoireApres/servitude/aGarant/meuble ajoutés (absents du
// fichier réel à ce jour, voir docs/backlog.md). Le vrai fichier du
// propriétaire nécessite encore ces corrections avant de pouvoir être
// utilisé tel quel — aGarant masque le paragraphe "caution solidaire"
// (GARANTS SOLIDAIRES) et la ligne "Acte de caution solidaire" des
// pièces annexées quand aucun garant n'est rattaché ; meuble masque la
// ligne "Etat descriptif et inventaire du mobilier" pour un bail vide.
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
  let versementsService: VersementsService;
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
        VersementsModule,
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
    versementsService = moduleRef.get(VersementsService);
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
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  // Assemble uniquement SCI/immeuble/appartement (partie commune à tous
  // les dossiers de test), pour permettre à un même appartement de porter
  // plusieurs baux successifs (bail précédent + nouveau bail) sans dupliquer
  // ce montage.
  async function creerAppartementDeBase() {
    const sci = await scisService.create(userId, { nom: "SCI Docx Test", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" });
    await scisService.update(sci.id, { telephone: "0555555555", estFamiliale: true });

    const immeuble = await immeublesService.create({
      sciId: sci.id,
      nom: "Immeuble Docx Test",
      adresse: "17 avenue du Test",
      codePostal: "19100",
      ville: "Brive",
      typeHabitat: "collectif",
      regimeJuridique: "copropriete"
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
      loyerReference: "650.00",
      nombrePiecesPrincipales: 3,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    await appartementsService.update(appartement.id, {
      equipementCuisine: "Plaques, four, réfrigérateur",
      dependancesAnnexes: "Cave"
    });

    return { sci, immeuble, appartement };
  }

  // Assemble un dossier complet (SCI, immeuble, appartement, locataire,
  // bail, garant) avec TOUS les champs requis par validerCompletudeGenerationBail
  // renseignés — `surcharges` permet à un test de rendre un champ précis
  // manquant ou de changer le régime, sans dupliquer tout le montage.
  async function creerDossierComplet(
    options: {
      dateDebut?: string;
      avecGarant?: boolean;
      avecIrl?: boolean;
      typeBail?: "vide" | "meuble";
    } = {}
  ) {
    const dateDebut = options.dateDebut ?? "2026-07-01";
    const avecGarant = options.avecGarant ?? true;
    const avecIrl = options.avecIrl ?? true;
    const typeBail = options.typeBail ?? "vide";

    if (avecIrl) {
      // annee 9999 : valeur délibérément hors de toute plage réaliste,
      // pour ne jamais entrer en collision avec une vraie ligne publiée
      // par l'INSEE et déjà présente en base dev (contrainte d'unicité
      // (annee, trimestre) partagée avec les données réelles, pas
      // seulement entre transactions de test isolées — un vrai bug
      // constaté : ce test entrait en conflit avec la ligne 2026-Q2
      // réellement synchronisée pendant ce chantier). date_recuperation
      // = maintenant, jamais périmée par défaut.
      await db.insert(indicesIrl).values({ annee: 9999, trimestre: 2, valeur: "148.37" });
    }

    const { sci, immeuble, appartement } = await creerAppartementDeBase();

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
      typeBail,
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

    // Vraie valeur IRL insérée, jamais un texte à compléter.
    expect(texte).toContain("148.37");
    expect(texte).not.toContain("non disponible");

    // Locataire seul (pas de colocation) : jamais la clause d'extinction de
    // solidarité (art. 8-1, réservée aux baux à plusieurs locataires).
    expect(texte).not.toContain("article 8-1");
    // Aucun bail précédent sur cet appartement : jamais la mention du loyer
    // du précédent locataire (art. 3, loi n° 89-462).
    expect(texte).not.toContain("le précédent locataire ayant quitté");

    // Aucun document diagnostic rattaché : les 4 lignes de la section
    // PIECES ANNEXEES restent absentes.
    expect(texte).not.toContain("Diagnostic de performance énergétique");
    expect(texte).not.toContain("Constat de risque d'exposition au plomb");
    expect(texte).not.toContain("installation intérieure d'électricité et de gaz");
    expect(texte).not.toContain("risques naturels et technologiques");

    // Garant présent (avecGarant par défaut) : le paragraphe d'engagement
    // de caution solidaire doit apparaître (phrase précise, distincte de
    // la mention "caution solidaire" du bloc signature qui reste toujours
    // imprimée, garant ou non).
    expect(texte).toContain("caution solidaire du locataire");

    // Bail vide (typeBail par défaut) : jamais la mention réservée au
    // meublé (inventaire de mobilier, docs/backlog.md).
    expect(texte).not.toContain("inventaire du mobilier");
  });

  it("bloque si aucune valeur IRL n'existe en base", async () => {
    const { bail } = await creerDossierComplet({ avecIrl: false });
    // Vide la table dans cette transaction (annulé au rollback) : la base
    // de dev partagée peut déjà contenir de vraies lignes synchronisées
    // par le job réel, indépendamment de ce test — ne jamais supposer la
    // table vide sans le garantir explicitement.
    await db.delete(indicesIrl);

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
    expect(reponse.champsManquants).toContain(
      "Indice de référence des loyers (IRL) — aucune valeur récente disponible"
    );
  });

  it("bloque si la dernière valeur IRL connue est périmée (plus de 4 mois)", async () => {
    const { bail } = await creerDossierComplet({ avecIrl: false });
    // Même précaution que le test précédent : ne jamais supposer la table
    // vide, la base de dev partagée peut déjà contenir de vraies lignes.
    await db.delete(indicesIrl);
    const dateRecuperationPerimee = new Date();
    dateRecuperationPerimee.setMonth(dateRecuperationPerimee.getMonth() - 5);
    await db.insert(indicesIrl).values({ annee: 2025, trimestre: 1, valeur: "145.00", dateRecuperation: dateRecuperationPerimee });

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
    expect(reponse.champsManquants).toContain(
      "Indice de référence des loyers (IRL) — aucune valeur récente disponible"
    );
  });

  it("régime à partir du 1er octobre 2026 avec servitude explicitement demandée", async () => {
    const { bail } = await creerDossierComplet({ dateDebut: "2026-10-01" });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, { servitudeResidencePrincipale: true })
    );

    const texte = texteDuDocx(buffer);
    expect(texte).toContain("six semaines");
    expect(texte).not.toContain("deux mois après la date d'un commandement");
    // Section II.B (DESTINATION EXCLUSIVE DES LOCAUX).
    expect(texte).toContain("Servitude de résidence principale");
    // Section VIII (CLAUSE RESOLUTOIRE) : motif ajouté par le décret
    // n° 2026-596 lui-même (art. L. 151-14-1 du code de l'urbanisme, délai
    // de mise en demeure du maire selon l'art. L. 481-4, II du même code) —
    // même flag servitude, deuxième mention distincte dans le document.
    expect(texte).toContain(
      "Il en est de même, lorsque le logement est soumis à l'obligation prévue à l'article L. 151-14-1 du code de l'urbanisme, pour le non-respect de l'obligation de l'occuper exclusivement à titre de résidence principale. Dans ce dernier cas, la clause ne peut produire effet qu'à l'expiration d'un délai de mise en demeure fixé par le maire conformément au II de l'article L. 481-4 du code de l'urbanisme."
    );
  });

  it("ne mentionne jamais la servitude si le paramètre n'est pas explicitement fourni, même après le 1er octobre 2026", async () => {
    const { bail } = await creerDossierComplet({ dateDebut: "2026-10-01" });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    const texte = texteDuDocx(buffer);
    expect(texte).not.toContain("Servitude de résidence principale");
    expect(texte).not.toContain("L. 481-4");
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

    // Sans garant, le paragraphe d'engagement de caution solidaire ne
    // doit jamais être imprimé avec des champs vides — masqué (gap réel
    // constaté sur le bail Ilan Devos, aucun garant rattaché). La mention
    // "caution solidaire" du bloc signature (toujours présente, garant ou
    // non) n'est pas concernée par ce test.
    const texte = texteDuDocx(buffer);
    expect(texte).not.toContain("caution solidaire du locataire");
  });

  it("un bail meublé mentionne l'inventaire de mobilier, jamais un bail vide", async () => {
    const { bail: bailVide } = await creerDossierComplet({ typeBail: "vide" });
    const bufferVide = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bailVide.id, {})
    );
    expect(texteDuDocx(bufferVide)).not.toContain("inventaire du mobilier");

    const { bail: bailMeuble } = await creerDossierComplet({ typeBail: "meuble", avecIrl: false });
    const bufferMeuble = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bailMeuble.id, {})
    );
    expect(texteDuDocx(bufferMeuble)).toContain("inventaire du mobilier");
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

  it("mentionne la clause d'extinction de solidarité (art. 8-1) en cas de colocation réelle", async () => {
    const { bail, locataire } = await creerDossierComplet();
    const colocataire = await locatairesService.create({ nom: "Colocataire", prenom: "Second" });
    await locatairesService.update(colocataire.id, { adresse: "X", codePostal: "X", ville: "X" });
    await bailLocatairesService.create({
      bailId: bail.id,
      locataireId: colocataire.id,
      role: "colocataire"
    });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    const texte = texteDuDocx(buffer);
    expect(texte).toContain(locataire.nom);
    expect(texte).toContain(
      "Conformément à l'article 8-1, VI, alinéa 1er, de la loi n° 89-462 du 6 juillet 1989, la solidarité d'un des colocataires et celle de la personne qui s'est portée caution pour lui prennent fin à la date d'effet du congé régulièrement délivré et lorsqu'un nouveau colocataire figure au bail. A défaut, elles s'éteignent au plus tard à l'expiration d'un délai de six mois après la date d'effet du congé."
    );
  });

  it("mentionne le loyer du précédent locataire (montant et date de versement) quand celui-ci est parti moins de 18 mois avant la signature", async () => {
    const { appartement } = await creerAppartementDeBase();
    await db.insert(indicesIrl).values({ annee: 9999, trimestre: 2, valeur: "148.37" });

    // Bail précédent, activé puis résilié moins de 18 mois avant la
    // signature du nouveau bail — avec un versement de loyer enregistré,
    // seule source possible de la "date de versement" exigée par l'article
    // 3 de la loi n° 89-462.
    const bailPrecedent = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2024-01-01",
      loyerMensuel: "600.00",
      jourEcheance: 5
    });
    await bauxService.activer(bailPrecedent.id);
    const [paiementLoyerPrecedent] = await db
      .select()
      .from(paiements)
      .where(and(eq(paiements.bailId, bailPrecedent.id), eq(paiements.type, "loyer")));
    if (!paiementLoyerPrecedent) {
      throw new Error("Échéance de loyer introuvable pour le bail précédent");
    }
    await versementsService.ajouter({
      paiementId: paiementLoyerPrecedent.id,
      montant: "600.00",
      mode: "virement",
      dateVersement: "2024-01-05"
    });
    await bauxService.resilier(bailPrecedent.id, { dateFin: "2026-01-15" });

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
      dateDebut: "2026-06-01",
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
    await garantsService.create({
      bailId: bail.id,
      nom: "Durand",
      prenom: "Claire",
      typeGarantie: "personne_physique",
      dateNaissance: "1965-03-20",
      lieuNaissance: "Lyon",
      nationalite: "Française"
    });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    const texte = texteDuDocx(buffer);
    expect(texte).toContain(
      "Conformément à l'article 3 de la loi n° 89-462 du 6 juillet 1989, le précédent locataire ayant quitté le logement moins de dix-huit mois avant la signature du présent bail, il est précisé que le montant du dernier loyer qui lui a été appliqué s'élevait à 600.00 € et que ce loyer a été versé le 2024-01-05."
    );
  });

  it("mentionne le montant seul du loyer précédent quand aucun versement n'est retrouvé pour le bail précédent", async () => {
    const { appartement } = await creerAppartementDeBase();
    await db.insert(indicesIrl).values({ annee: 9999, trimestre: 2, valeur: "148.37" });

    // Bail précédent activé (échéance de loyer générée) mais SANS versement
    // enregistré dessus — données antérieures au suivi strict des
    // versements, ou paiement jamais tracé.
    const bailPrecedent = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2024-01-01",
      loyerMensuel: "600.00",
      jourEcheance: 5
    });
    await bauxService.activer(bailPrecedent.id);
    await bauxService.resilier(bailPrecedent.id, { dateFin: "2026-01-15" });

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
      dateDebut: "2026-06-01",
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
    await garantsService.create({
      bailId: bail.id,
      nom: "Durand",
      prenom: "Claire",
      typeGarantie: "personne_physique",
      dateNaissance: "1965-03-20",
      lieuNaissance: "Lyon",
      nationalite: "Française"
    });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    const texte = texteDuDocx(buffer);
    expect(texte).toContain(
      "Conformément à l'article 3 de la loi n° 89-462 du 6 juillet 1989, le précédent locataire ayant quitté le logement moins de dix-huit mois avant la signature du présent bail, il est précisé que le montant du dernier loyer qui lui a été appliqué s'élevait à 600.00 €."
    );
    expect(texte).not.toContain("et que ce loyer a été versé le");
  });

  it("ne mentionne jamais le loyer du précédent locataire si celui-ci est parti il y a plus de 18 mois", async () => {
    const { appartement } = await creerAppartementDeBase();
    await db.insert(indicesIrl).values({ annee: 9999, trimestre: 2, valeur: "148.37" });

    const bailPrecedent = await bauxService.create({
      appartementId: appartement.id,
      typeBail: "vide",
      dateDebut: "2020-01-01",
      loyerMensuel: "600.00",
      jourEcheance: 5
    });
    await bauxService.activer(bailPrecedent.id);
    // Largement plus de 18 mois avant le nouveau bail (2026-06-01).
    await bauxService.resilier(bailPrecedent.id, { dateFin: "2022-01-15" });

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
      dateDebut: "2026-06-01",
      loyerMensuel: "650.00",
      depotGarantie: "650.00",
      provisionsCharges: "30.00",
      jourEcheance: 5
    });
    await bailLocatairesService.create({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
    await garantsService.create({
      bailId: bail.id,
      nom: "Durand",
      prenom: "Claire",
      typeGarantie: "personne_physique",
      dateNaissance: "1965-03-20",
      lieuNaissance: "Lyon",
      nationalite: "Française"
    });

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    const texte = texteDuDocx(buffer);
    expect(texte).not.toContain("le précédent locataire ayant quitté");
  });

  // Écriture directe en base : seule la présence d'un document catégorisé
  // compte ici, pas le cycle d'upload chiffré complet (hors sujet pour ce
  // test — voir documents.integration.spec.ts pour l'upload réel).
  async function creerDocumentTest(
    entiteType: "appartement" | "immeuble",
    entiteId: string,
    categorie: "dpe" | "crep_plomb" | "elec_gaz" | "erp" | "diagnostic",
    archive = false
  ) {
    await db.insert(documents).values({
      entiteType,
      entiteId,
      categorie,
      nomFichier: "test.pdf",
      mimeType: "application/pdf",
      tailleOctets: 1,
      cheminStockage: `test/${randomUUID()}.enc`,
      archivedAt: archive ? new Date() : null
    });
  }

  it("mentionne les diagnostics présents en pièce annexée, rattachés à l'immeuble ou à l'appartement indifféremment", async () => {
    const { bail, appartement, immeuble } = await creerDossierComplet();
    await creerDocumentTest("appartement", appartement.id, "dpe");
    await creerDocumentTest("appartement", appartement.id, "crep_plomb");
    await creerDocumentTest("immeuble", immeuble.id, "elec_gaz");
    await creerDocumentTest("immeuble", immeuble.id, "erp");

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    const texte = texteDuDocx(buffer);
    expect(texte).toContain("Diagnostic de performance énergétique (DPE).");
    expect(texte).toContain("Constat de risque d'exposition au plomb (CREP).");
    expect(texte).toContain("État de l'installation intérieure d'électricité et de gaz.");
    expect(texte).toContain("État des risques naturels et technologiques (ERP).");
  });

  it("ignore un document diagnostic archivé (ne le compte pas comme présent)", async () => {
    const { bail, appartement } = await creerDossierComplet();
    await creerDocumentTest("appartement", appartement.id, "dpe", true);

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    const texte = texteDuDocx(buffer);
    expect(texte).not.toContain("Diagnostic de performance énergétique");
  });

  it("ne confond jamais la catégorie générique 'diagnostic' avec une des 4 valeurs dédiées", async () => {
    const { bail, appartement } = await creerDossierComplet();
    await creerDocumentTest("appartement", appartement.id, "diagnostic");

    const buffer = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      bailDocumentDocxService.genererDocumentBailDocx(bail.id, {})
    );

    const texte = texteDuDocx(buffer);
    expect(texte).not.toContain("Diagnostic de performance énergétique");
    expect(texte).not.toContain("Constat de risque d'exposition au plomb");
    expect(texte).not.toContain("installation intérieure d'électricité et de gaz");
    expect(texte).not.toContain("risques naturels et technologiques");
  });
});
