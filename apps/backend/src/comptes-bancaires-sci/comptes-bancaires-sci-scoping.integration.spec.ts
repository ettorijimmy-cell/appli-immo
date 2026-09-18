import { randomUUID } from "crypto";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { comptesBancairesSci, createDbClient, DEFAULT_DEV_DATABASE_URL, organisations, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/audit.service";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { EncryptionService } from "../crypto/encryption.service";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { ComptesBancairesSciModule } from "./comptes-bancaires-sci.module";
import { ComptesBancairesSciService } from "./comptes-bancaires-sci.service";

interface FixtureOrganisation {
  organisationId: string;
  userId: string;
  sciId: string;
}

// Commit B6 (chantier scoping multi-organisation, 2026-09-18) :
// ComptesBancairesSciService.findBySciIdDecrypted déchiffrait et
// renvoyait IBAN/BIC réels pour n'importe quel sciId, sans aucun
// contrôle d'appartenance — la faille la plus sévère de tout le
// chantier. create() acceptait de même un sciId arbitraire. Les tests
// ci-dessous vérifient non seulement le code 404, mais aussi que le
// déchiffrement (et la journalisation d'accès sensible) n'a JAMAIS lieu
// sur le chemin refusé — un test qui ne vérifierait que le NotFoundException
// laisserait passer une implémentation qui déchiffre puis jette l'erreur.
describe("ComptesBancairesSciService — contrôle d'appartenance à l'organisation (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let comptesBancairesSciService: ComptesBancairesSciService;
  let requestContextService: RequestContextService;
  let encryptionService: EncryptionService;
  let auditService: AuditService;

  let orgA: FixtureOrganisation;
  let orgB: FixtureOrganisation;

  async function creerFixtureOrganisation(suffixe: string): Promise<FixtureOrganisation> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation CBS Scoping ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `cbs-scoping-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `CbsScoping${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }

    const sci = await scisService.create(user.id, {
      nom: `SCI CBS Scoping ${suffixe}`,
      regimeFiscal: "IR",
      adresse: "1 rue de Test",
      codePostal: "75001",
      ville: "Paris"
    });

    return { organisationId: organisation.id, userId: user.id, sciId: sci.id };
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
        ComptesBancairesSciModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    comptesBancairesSciService = moduleRef.get(ComptesBancairesSciService);
    requestContextService = moduleRef.get(RequestContextService);
    encryptionService = moduleRef.get(EncryptionService);
    auditService = moduleRef.get(AuditService);

    orgA = await creerFixtureOrganisation("A");
    orgB = await creerFixtureOrganisation("B");

    // Un compte bancaire réel pour la SCI de l'organisation A — c'est
    // celui qu'une organisation B ne doit jamais pouvoir atteindre.
    await comptesBancairesSciService.create({
      sciId: orgA.sciId,
      iban: "FR7630006000011234567890189",
      bic: "AGRIFRPP123"
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  function contexteOrgA<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgA.userId, organisationId: orgA.organisationId }, fn);
  }
  function contexteOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte({ utilisateurId: orgB.userId, organisationId: orgB.organisationId }, fn);
  }

  it("findBySciIdDecrypted : renvoie l'IBAN/BIC réels quand la SCI appartient à l'organisation appelante", async () => {
    const comptes = await contexteOrgA(() =>
      comptesBancairesSciService.findBySciIdDecrypted(orgA.sciId, orgA.userId)
    );
    expect(comptes).toHaveLength(1);
    expect(comptes[0]?.iban).toBe("FR7630006000011234567890189");
    expect(comptes[0]?.bic).toBe("AGRIFRPP123");
  });

  it("findBySciIdDecrypted : 404 sur le sciId d'une autre organisation, sans jamais déchiffrer ni journaliser", async () => {
    const decryptSpy = vi.spyOn(encryptionService, "decrypt");
    const auditSpy = vi.spyOn(auditService, "logAccesDocumentSensible");

    await expect(
      contexteOrgB(() => comptesBancairesSciService.findBySciIdDecrypted(orgA.sciId, orgB.userId))
    ).rejects.toThrow(NotFoundException);

    expect(decryptSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("findBySciIdDecrypted : 404 sur un sciId inexistant, sans jamais déchiffrer ni journaliser", async () => {
    const decryptSpy = vi.spyOn(encryptionService, "decrypt");
    const auditSpy = vi.spyOn(auditService, "logAccesDocumentSensible");

    await expect(
      contexteOrgA(() => comptesBancairesSciService.findBySciIdDecrypted(randomUUID(), orgA.userId))
    ).rejects.toThrow(NotFoundException);

    expect(decryptSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("findBySciIdDecrypted : hors contexte HTTP (organisationId absent), le contrôle est ignoré — comportement préexistant préservé", async () => {
    const comptes = await requestContextService.executerAvecContexte(
      { utilisateurId: orgA.userId },
      () => comptesBancairesSciService.findBySciIdDecrypted(orgA.sciId, orgA.userId)
    );
    expect(comptes).toHaveLength(1);
    expect(comptes[0]?.iban).toBe("FR7630006000011234567890189");
  });

  it("create : réussit normalement quand le sciId appartient à l'organisation appelante", async () => {
    const compte = await contexteOrgB(() =>
      comptesBancairesSciService.create({
        sciId: orgB.sciId,
        iban: "FR7610011000201234567890188",
        bic: "PSSTFRPPPAR"
      })
    );
    expect(compte.sciId).toBe(orgB.sciId);
  });

  it("create : 404 sur le sciId d'une autre organisation, sans jamais chiffrer ni insérer de ligne", async () => {
    const encryptSpy = vi.spyOn(encryptionService, "encrypt");

    await expect(
      contexteOrgB(() =>
        comptesBancairesSciService.create({
          sciId: orgA.sciId,
          iban: "FR7610011000201234567890188",
          bic: "PSSTFRPPPAR"
        })
      )
    ).rejects.toThrow(NotFoundException);

    expect(encryptSpy).not.toHaveBeenCalled();

    const lignes = await db.select().from(comptesBancairesSci).where(eq(comptesBancairesSci.sciId, orgA.sciId));
    expect(lignes).toHaveLength(1); // uniquement celle créée dans beforeEach, aucune ajoutée par l'appel refusé
  });

  it("create : 404 sur un sciId inexistant", async () => {
    await expect(
      contexteOrgA(() =>
        comptesBancairesSciService.create({
          sciId: randomUUID(),
          iban: "FR7610011000201234567890188",
          bic: "PSSTFRPPPAR"
        })
      )
    ).rejects.toThrow(NotFoundException);
  });
});
