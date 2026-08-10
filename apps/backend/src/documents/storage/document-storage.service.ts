import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EncryptionService } from "../../crypto/encryption.service";

/**
 * Repli local temporaire en attendant Scaleway Object Storage (Module 0,
 * jamais provisionné à ce stade) — voir docs/data-dictionary.md, section
 * documents. Écrit sur disque un blob chiffré (AES-256-GCM,
 * EncryptionService.encryptBuffer), sous un nom opaque (UUID, indépendant
 * de l'id de la ligne `documents`) : le nom de fichier original reste
 * uniquement en base (`documents.nom_fichier`), jamais sur le nom réel du
 * fichier disque.
 */
@Injectable()
export class DocumentStorageService {
  private readonly storageDir: string;

  constructor(
    private readonly encryptionService: EncryptionService,
    config: ConfigService
  ) {
    this.storageDir =
      config.get<string>("DOCUMENTS_STORAGE_DIR") ?? path.join(process.cwd(), "storage", "documents");
  }

  async enregistrer(contenu: Buffer): Promise<string> {
    await mkdir(this.storageDir, { recursive: true });
    const nomStockage = `${randomUUID()}.enc`;
    const chiffre = this.encryptionService.encryptBuffer(contenu);
    await writeFile(path.join(this.storageDir, nomStockage), chiffre);
    return nomStockage;
  }

  async lire(cheminStockage: string): Promise<Buffer> {
    const chiffre = await readFile(path.join(this.storageDir, cheminStockage));
    return this.encryptionService.decryptBuffer(chiffre);
  }
}
