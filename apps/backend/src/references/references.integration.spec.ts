import { randomUUID } from "crypto";
import { mkdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EncryptionModule } from "../crypto/encryption.module";
import { DocumentStorageService } from "../documents/storage/document-storage.service";
import { ReferencesService } from "./references.service";

// Aucune donnée Postgres impliquée (pas de table `documents`, pas
// d'entité) : seul le stockage fichier est en jeu, jamais chiffré (texte
// légal public — voir ReferencesService). DOCUMENTS_STORAGE_DIR pointe
// vers un dossier temporaire dédié, nettoyé dans afterAll.
describe("References — fichiers fixes non rattachés à une entité (intégration)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-references-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  let moduleRef: TestingModule;
  let referencesService: ReferencesService;
  const contenuAttendu = Buffer.from("%PDF-1.4 contenu de test de la notice", "utf8");

  beforeAll(async () => {
    await mkdir(path.join(storageDirTest, "references"), { recursive: true });
    await writeFile(path.join(storageDirTest, "references", "notice-information-bail.pdf"), contenuAttendu);

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), EncryptionModule],
      providers: [ReferencesService, DocumentStorageService]
    }).compile();
    referencesService = moduleRef.get(ReferencesService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  it("renvoie le contenu exact, non déchiffré (jamais chiffré à l'écriture)", async () => {
    const resultat = await referencesService.telecharger("notice-information-bail");

    expect(resultat.contenu.equals(contenuAttendu)).toBe(true);
    expect(resultat.nomFichier).toBe("notice-information-bail.pdf");
    expect(resultat.mimeType).toBe("application/pdf");
  });

  it("rejette un slug inconnu avec 404, sans jamais tenter de lire le disque", async () => {
    await expect(referencesService.telecharger("slug-inexistant")).rejects.toBeInstanceOf(NotFoundException);
  });
});
