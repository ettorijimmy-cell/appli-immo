import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  comptesBancairesSci,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  journalAudit,
  organisations,
  organisationSci,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { ComptesBancairesSciModule } from "../comptes-bancaires-sci/comptes-bancaires-sci.module";
import { ComptesBancairesSciService } from "../comptes-bancaires-sci/comptes-bancaires-sci.service";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { ScisModule } from "./scis.module";
import { ScisService } from "./scis.service";

// Vérifie le critère de complétion du Module 1 (docs/backlog.md) : créer
// une SCI, lui associer un compte bancaire, vérifier que l'IBAN n'apparaît
// jamais en clair en base. Tourne contre un vrai Postgres (voir
// auth.integration.spec.ts pour le fonctionnement général).
//
// Chaque test tourne dans sa propre transaction annulée dans afterEach (voir
// test-utils/transactional-test.ts), setup (organisation + utilisateur)
// compris.
describe("SCI + comptes bancaires (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let scisService: ScisService;
  let comptesBancairesSciService: ComptesBancairesSciService;
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
        ScisModule,
        ComptesBancairesSciModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    comptesBancairesSciService = moduleRef.get(ComptesBancairesSciService);

    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: "Organisation SCI Intégration" })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    organisationId = organisation.id;

    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId,
        email: `sci-integration-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "SCI",
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

  it("rattache automatiquement l'organisation créatrice avec le rôle proprietaire", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Les Tilleuls",
      regimeFiscal: "IR"
    });

    const [rattachement] = await db
      .select()
      .from(organisationSci)
      .where(eq(organisationSci.sciId, sci.id));

    expect(rattachement).toMatchObject({
      organisationId,
      sciId: sci.id,
      role: "proprietaire"
    });
    expect(rattachement?.dateFin).toBeNull();
  });

  it("modifie une SCI existante (nom, régime fiscal, forme juridique, SIRET)", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI À Corriger",
      regimeFiscal: "IR"
    });

    const modifiee = await scisService.update(sci.id, {
      nom: "SCI Corrigée",
      regimeFiscal: "IS",
      formeJuridique: "SARL de famille",
      siret: "12345678900012"
    });

    expect(modifiee).toMatchObject({
      id: sci.id,
      nom: "SCI Corrigée",
      regimeFiscal: "IS",
      formeJuridique: "SARL de famille",
      siret: "12345678900012"
    });

    const relue = await scisService.findById(sci.id);
    expect(relue).toMatchObject({ nom: "SCI Corrigée", regimeFiscal: "IS" });
  });

  it("chiffre l'IBAN/BIC en base et les déchiffre uniquement via l'endpoint dédié", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Le Chêne",
      regimeFiscal: "IS"
    });

    const iban = "FR7630006000011234567890189";
    const bic = "BNPAFRPPXXX";

    const created = await comptesBancairesSciService.create({
      sciId: sci.id,
      iban,
      bic
    });

    const [rowEnBase] = await db
      .select()
      .from(comptesBancairesSci)
      .where(eq(comptesBancairesSci.id, created.id));

    // L'IBAN/BIC ne doit jamais apparaître en clair en base.
    expect(rowEnBase?.ibanChiffre).not.toBe(iban);
    expect(rowEnBase?.ibanChiffre).not.toContain(iban);
    expect(rowEnBase?.bicChiffre).not.toBe(bic);

    const comptes = await comptesBancairesSciService.findBySciIdDecrypted(sci.id, userId);
    expect(comptes).toEqual([{ id: created.id, sciId: sci.id, iban, bic }]);
  });

  it("consigne un accès à un document sensible dans journal_audit à chaque déchiffrement", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Audit",
      regimeFiscal: "IR"
    });

    await comptesBancairesSciService.create({
      sciId: sci.id,
      iban: "FR7630006000011234567890189",
      bic: "BNPAFRPPXXX"
    });

    await comptesBancairesSciService.findBySciIdDecrypted(sci.id, userId);

    const entreesAudit = await db
      .select()
      .from(journalAudit)
      .where(eq(journalAudit.entiteId, sci.id));

    expect(entreesAudit).toHaveLength(1);
    expect(entreesAudit[0]).toMatchObject({
      entiteType: "document_sensible",
      entiteId: sci.id,
      action: "acces",
      utilisateurId: userId
    });
    expect(entreesAudit[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("ne consigne rien si aucun compte bancaire n'existe pour la SCI", async () => {
    const sci = await scisService.create(userId, {
      nom: "SCI Sans Compte",
      regimeFiscal: "IR"
    });

    await comptesBancairesSciService.findBySciIdDecrypted(sci.id, userId);

    const entreesAudit = await db
      .select()
      .from(journalAudit)
      .where(eq(journalAudit.entiteId, sci.id));

    expect(entreesAudit).toHaveLength(0);
  });
});
