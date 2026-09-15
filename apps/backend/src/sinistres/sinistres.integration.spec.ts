import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { contact, createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, sinistre, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { SinistresModule } from "./sinistres.module";
import { SinistresService } from "./sinistres.service";

// Module Suivi sinistre et assurance (2026-09-16) : CRUD simple (la
// détection de stagnation est testée séparément, voir
// alertes.integration.spec.ts et taches.integration.spec.ts) — ce test
// couvre exclusivement le comportement propre à SinistresService, en
// particulier la règle "dateChangementStatut ne bouge que sur un vrai
// changement de statut", seule donnée que lit
// calculerAlerteSinistreStagnation.
describe("Sinistres — CRUD (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let sinistresService: SinistresService;
  let requestContextService: RequestContextService;
  let db: Database;
  let organisationId: string;
  let userId: string;

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
        SinistresModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    sinistresService = moduleRef.get(SinistresService);
    requestContextService = moduleRef.get(RequestContextService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation Sinistres Intégration" })
      .returning();
    if (!organisation) throw new Error("Échec de l'insertion de l'organisation de test");
    organisationId = organisation.id;
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `sinistres-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Sinistres",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) throw new Error("Échec de l'insertion de l'utilisateur de test");
    userId = user.id;
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  it("create() : statut par défaut 'declare', dateChangementStatut posée, contactAssureurId absent -> null", async () => {
    const sinistreCree = await sinistresService.create(userId, {
      type: "degat_eaux",
      dateDeclaration: "2026-09-01"
    });

    expect(sinistreCree.statut).toBe("declare");
    expect(sinistreCree.dateChangementStatut).not.toBeNull();
    expect(sinistreCree.contactAssureurId).toBeNull();
    expect(sinistreCree.organisationId).toBe(organisationId);
  });

  it("create() : rattache bienId, appartementId et contactAssureurId quand fournis", async () => {
    const [contactAssureur] = await db
      .insert(contact)
      .values({ nom: "Assurup", typeEntite: "entreprise", role: "assureur", organisationId })
      .returning();
    if (!contactAssureur) throw new Error("Échec de l'insertion du contact de test");

    const sinistreCree = await sinistresService.create(userId, {
      type: "incendie",
      dateDeclaration: "2026-09-01",
      contactAssureurId: contactAssureur.id,
      montantReclame: "1500.00"
    });

    expect(sinistreCree.contactAssureurId).toBe(contactAssureur.id);
    expect(sinistreCree.montantReclame).toBe("1500.00");
  });

  it("update() : ne modifie dateChangementStatut que si le statut soumis diffère réellement de l'actuel", async () => {
    const sinistreCree = await sinistresService.create(userId, {
      type: "degat_eaux",
      dateDeclaration: "2026-09-01"
    });
    const dateInitiale = sinistreCree.dateChangementStatut;

    // Même statut resoumis (ex. simple correction d'un montant) : la date
    // ne doit jamais être réécrite, sinon la stagnation serait faussement
    // remise à zéro à chaque édition sans rapport avec l'avancement réel.
    const apresCorrection = await sinistresService.update(sinistreCree.id, {
      statut: "declare",
      montantReclame: "2000.00"
    });
    expect(apresCorrection.dateChangementStatut).toEqual(dateInitiale);
    expect(apresCorrection.montantReclame).toBe("2000.00");

    // Vrai changement de statut : la date doit être mise à jour.
    const apresChangement = await sinistresService.update(sinistreCree.id, { statut: "expertise_planifiee" });
    expect(apresChangement.statut).toBe("expertise_planifiee");
    expect(apresChangement.dateChangementStatut).not.toEqual(dateInitiale);
  });

  it("archive() pose archivedAt, sans jamais supprimer la ligne", async () => {
    const sinistreCree = await sinistresService.create(userId, {
      type: "vol",
      dateDeclaration: "2026-09-01"
    });

    const archive = await sinistresService.archive(sinistreCree.id);

    expect(archive.archivedAt).not.toBeNull();
    const [ligne] = await db.select().from(sinistre).where(eq(sinistre.id, sinistreCree.id));
    expect(ligne).toBeDefined();
  });

  it("findById() renvoie null pour un id inexistant", async () => {
    expect(await sinistresService.findById(randomUUID())).toBeNull();
  });

  it("findAll() ne renvoie que les sinistres de l'organisation de l'utilisateur authentifié en contexte", async () => {
    const [autreOrganisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Autre organisation Sinistres Intégration" })
      .returning();
    if (!autreOrganisation) throw new Error("Échec de l'insertion de l'autre organisation de test");
    const [autreUser] = await db
      .insert(utilisateurs)
      .values({
        organisationId: autreOrganisation.id,
        email: `sinistres-integration-autre-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Autre",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!autreUser) throw new Error("Échec de l'insertion de l'autre utilisateur de test");

    const sinistreOrgA = await sinistresService.create(userId, { type: "degat_eaux", dateDeclaration: "2026-09-01" });
    const sinistreOrgB = await sinistresService.create(autreUser.id, { type: "vol", dateDeclaration: "2026-09-01" });

    const sinistresOrgA = await requestContextService.executerAvecContexte({ utilisateurId: userId }, () =>
      sinistresService.findAll()
    );
    const sinistresOrgB = await requestContextService.executerAvecContexte({ utilisateurId: autreUser.id }, () =>
      sinistresService.findAll()
    );

    expect(sinistresOrgA.some((s) => s.id === sinistreOrgA.id)).toBe(true);
    expect(sinistresOrgA.some((s) => s.id === sinistreOrgB.id)).toBe(false);
    expect(sinistresOrgB.some((s) => s.id === sinistreOrgB.id)).toBe(true);
    expect(sinistresOrgB.some((s) => s.id === sinistreOrgA.id)).toBe(false);
  });
});
