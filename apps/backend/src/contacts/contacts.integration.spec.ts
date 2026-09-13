import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { GarantsModule } from "../garants/garants.module";
import { GarantsService } from "../garants/garants.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { ContactsModule } from "./contacts.module";
import { ContactsService } from "./contacts.service";

// Module Carnet de contacts (2026-09-13) : contacts professionnels
// (create/findAll/update/archive, jamais rattachés à un bien) +
// agrégation en lecture seule avec locataires/garants (findAllUnifie).
// Chaque test tourne dans sa propre transaction annulée dans afterEach
// (voir test-utils/transactional-test.ts).
describe("ContactsService (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let contactsService: ContactsService;
  let locatairesService: LocatairesService;
  let garantsService: GarantsService;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let requestContextService: RequestContextService;
  let db: Database;
  let userId: string;
  let appartementId: string;

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        UsersModule,
        ScisModule,
        BienModule,
        AppartementsModule,
        BauxModule,
        LocatairesModule,
        GarantsModule,
        ContactsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    contactsService = moduleRef.get(ContactsService);
    locatairesService = moduleRef.get(LocatairesService);
    garantsService = moduleRef.get(GarantsService);
    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Contacts Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `contacts-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Contacts",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    userId = user.id;

    const sci = await scisService.create(userId, {
      nom: "SCI Contacts Test",
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });
    const bien = await bienService.create(userId, {
      type: "immeuble",
      proprietaireType: "sci",
      sciId: sci.id,
      nom: "Immeuble Contacts Test",
      adresse: "1 rue des Contacts",
      codePostal: "75001",
      ville: "Paris",
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
      loyerReference: "800.00"
    });
    appartementId = appartement.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("crée un contact professionnel, jamais rattaché à un bien", async () => {
    const contact = await contactsService.create(userId, {
      nom: "Plomberie Dupont",
      typeEntite: "entreprise",
      role: "artisan",
      telephone: "0600000000",
      email: "contact@plomberie-dupont.fr",
      notes: "Intervient rapidement, tarif correct"
    });

    expect(contact.nom).toBe("Plomberie Dupont");
    expect(contact.role).toBe("artisan");
    expect(contact).not.toHaveProperty("bienId");
  });

  it("archive un contact sans le supprimer physiquement", async () => {
    const contact = await contactsService.create(userId, {
      nom: "Assurance Martin",
      typeEntite: "entreprise",
      role: "assureur"
    });

    const archive = await contactsService.archive(contact.id);
    expect(archive.archivedAt).not.toBeNull();

    const relu = await contactsService.findById(contact.id);
    expect(relu).not.toBeNull();
    expect(relu?.archivedAt).not.toBeNull();
  });

  it("met à jour un contact (nom, coordonnées)", async () => {
    const contact = await contactsService.create(userId, {
      nom: "Syndic Provisoire",
      typeEntite: "entreprise",
      role: "syndic"
    });

    const misAJour = await contactsService.update(contact.id, {
      nom: "Syndic Confirmé",
      telephone: "0611111111"
    });

    expect(misAJour.nom).toBe("Syndic Confirmé");
    expect(misAJour.telephone).toBe("0611111111");
  });

  it("findAll scope par organisation", async () => {
    const [autreOrganisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Autre Organisation Contacts" })
      .returning();
    if (!autreOrganisation) {
      throw new Error("Échec de l'insertion de l'autre organisation de test");
    }
    const [autreUser] = await db
      .insert(utilisateurs)
      .values({
        organisationId: autreOrganisation.id,
        email: `autre-org-contacts-${randomUUID()}@example.com`,
        nom: "Autre",
        prenom: "OrgContacts",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!autreUser) {
      throw new Error("Échec de l'insertion de l'autre utilisateur de test");
    }

    const contactOrgA = await contactsService.create(userId, {
      nom: "Diagnostiqueur A",
      typeEntite: "entreprise",
      role: "diagnostiqueur"
    });
    const contactOrgB = await contactsService.create(autreUser.id, {
      nom: "Diagnostiqueur B",
      typeEntite: "entreprise",
      role: "diagnostiqueur"
    });

    const listeOrgA = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      contactsService.findAll()
    );
    expect(listeOrgA.map((c) => c.id)).toContain(contactOrgA.id);
    expect(listeOrgA.map((c) => c.id)).not.toContain(contactOrgB.id);
  });

  it("findAllUnifie agrège locataires + garants (lecture seule) + contacts professionnels", async () => {
    const locataire = await locatairesService.create(userId, { nom: "Dupont", prenom: "Alice" });
    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });
    const garant = await garantsService.create({
      bailId: bail.id,
      nom: "Durand",
      prenom: "Claire",
      typeGarantie: "personne_physique"
    });
    const contactPro = await contactsService.create(userId, {
      nom: "Plomberie Dupont",
      typeEntite: "entreprise",
      role: "artisan",
      telephone: "0600000000"
    });

    const unifie = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      contactsService.findAllUnifie()
    );

    const ligneLocataire = unifie.find((c) => c.id === locataire.id);
    expect(ligneLocataire).toMatchObject({ type: "locataire", nom: "Alice Dupont" });

    const ligneGarant = unifie.find((c) => c.id === garant.id);
    expect(ligneGarant).toMatchObject({ type: "garant", nom: "Claire Durand", bailId: bail.id });

    const ligneContact = unifie.find((c) => c.id === contactPro.id);
    expect(ligneContact).toMatchObject({ type: "artisan", nom: "Plomberie Dupont", telephone: "0600000000" });
  });

  it("findAllUnifie exclut les entités archivées (locataire, garant et contact pro)", async () => {
    const locataire = await locatairesService.create(userId, { nom: "Archivé", prenom: "Locataire" });
    await locatairesService.archive(locataire.id);

    const bail = await bauxService.create({ appartementId, typeBail: "vide", dateDebut: "2026-08-01", jourEcheance: 5 });
    const garant = await garantsService.create({
      bailId: bail.id,
      nom: "Archivé",
      prenom: "Garant",
      typeGarantie: "personne_physique"
    });
    await garantsService.archive(garant.id);

    const contactPro = await contactsService.create(userId, {
      nom: "Contact Archivé",
      typeEntite: "entreprise",
      role: "autre"
    });
    await contactsService.archive(contactPro.id);

    const unifie = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      contactsService.findAllUnifie()
    );

    expect(unifie.map((c) => c.id)).not.toContain(locataire.id);
    expect(unifie.map((c) => c.id)).not.toContain(garant.id);
    expect(unifie.map((c) => c.id)).not.toContain(contactPro.id);
  });
});
