import path from "path";
import { InternalServerErrorException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDbClient, DEFAULT_DEV_DATABASE_URL, type Database } from "db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditModule } from "../audit/audit.module";
import { BienModule } from "../bien/bien.module";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { EtatDesLieuxDocumentDocxModule } from "./etat-des-lieux-document-docx.module";
import { EtatDesLieuxDocumentDocxService } from "./etat-des-lieux-document-docx.service";

// Chemin volontairement inexistant — reproduit un déploiement où l'asset
// n'a pas été copié dans l'image. Fichier de test dédié (plutôt qu'un cas
// de plus dans etat-des-lieux-document-docx.integration.spec.ts) car il
// fixe ETAT_DES_LIEUX_DOCUMENT_DOCX_TEMPLATE_PATH au chargement du module,
// une valeur incompatible avec les autres tests de ce dossier qui ont
// besoin de la vraie fixture. Même modèle que
// bail-document-docx-modele-manquant.integration.spec.ts.
const CHEMIN_INEXISTANT = path.join(__dirname, "__fixtures__", "modele-qui-n-existe-pas.docx");
process.env["ETAT_DES_LIEUX_DOCUMENT_DOCX_TEMPLATE_PATH"] = CHEMIN_INEXISTANT;

describe("EtatDesLieuxDocumentDocxService — modèle introuvable (intégration Postgres réelle)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let etatDesLieuxDocumentDocxService: EtatDesLieuxDocumentDocxService;
  let requestContextService: RequestContextService;

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        AuditModule,
        EncryptionModule,
        DocumentsModule,
        EtatsDesLieuxModule,
        BienModule,
        EtatDesLieuxDocumentDocxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    etatDesLieuxDocumentDocxService = moduleRef.get(EtatDesLieuxDocumentDocxService);
    requestContextService = moduleRef.get(RequestContextService);
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  // verifierIntegriteTemplate() (appelée en tout premier dans
  // genererDocumentEtatDesLieuxDocx, avant toute requête base de données)
  // échoue sur l'absence du fichier avant même de chercher l'état des
  // lieux — aucune fixture de dossier complet nécessaire pour ce test,
  // contrairement à l'équivalent bail (dont la vérification n'intervient
  // qu'en toute fin de génération).
  it("lève une InternalServerErrorException avec un message exploitable, sans exposer le chemin du serveur, avant toute requête base de données", async () => {
    let erreurCapturee: unknown;
    try {
      await requestContextService.executerAvecContexte({ utilisateurId: "peu-importe" }, () =>
        etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx("id-quelconque-jamais-atteint")
      );
    } catch (erreur) {
      erreurCapturee = erreur;
    }

    expect(erreurCapturee).toBeInstanceOf(InternalServerErrorException);
    const message = (erreurCapturee as InternalServerErrorException).message;
    expect(message).toContain("modèle d'état des lieux");
    expect(message).not.toContain(CHEMIN_INEXISTANT);
    expect(message).not.toContain(__dirname);
  });
});
