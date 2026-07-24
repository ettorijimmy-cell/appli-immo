import { randomUUID } from "crypto";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { comptesBancairesSci, organisations, organisationSci, utilisateurs, type Database } from "db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthModule } from "../auth/auth.module";
import { ComptesBancairesSciModule } from "../comptes-bancaires-sci/comptes-bancaires-sci.module";
import { ComptesBancairesSciService } from "../comptes-bancaires-sci/comptes-bancaires-sci.service";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { UsersModule } from "../users/users.module";
import { ScisModule } from "./scis.module";
import { ScisService } from "./scis.service";

// Vérifie le critère de complétion du Module 1 (docs/backlog.md) : créer
// une SCI, lui associer un compte bancaire, vérifier que l'IBAN n'apparaît
// jamais en clair en base. Tourne contre un vrai Postgres (voir
// auth.integration.spec.ts pour le fonctionnement général).
describe("SCI + comptes bancaires (intégration Postgres réelle)", () => {
  let scisService: ScisService;
  let comptesBancairesSciService: ComptesBancairesSciService;
  let db: Database;
  let organisationId: string;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        EncryptionModule,
        UsersModule,
        AuthModule,
        ScisModule,
        ComptesBancairesSciModule
      ]
    }).compile();

    scisService = moduleRef.get(ScisService);
    comptesBancairesSciService = moduleRef.get(ComptesBancairesSciService);
    db = moduleRef.get(DATABASE_CONNECTION);

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

  afterAll(async () => {
    await db.$client.end();
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

    const comptes = await comptesBancairesSciService.findBySciIdDecrypted(sci.id);
    expect(comptes).toEqual([{ id: created.id, sciId: sci.id, iban, bic }]);
  });
});
