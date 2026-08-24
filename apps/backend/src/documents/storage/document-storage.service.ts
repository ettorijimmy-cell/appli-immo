import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EncryptionService } from "../../crypto/encryption.service";

// Scaleway impose la région fr-par pour toutes les ressources du projet
// (voir docs/integrations.md) — pas de variable d'environnement dédiée,
// même logique que DEFAULT_DEV_DATABASE_URL côté packages/db.
const SCALEWAY_REGION = "fr-par";

interface ConfigurationS3 {
  client: S3Client;
  bucket: string;
}

/**
 * Deux backends selon la présence de OBJECT_STORAGE_ACCESS_KEY/
 * OBJECT_STORAGE_SECRET_KEY/OBJECT_STORAGE_BUCKET_NAME — même bascule que
 * DATABASE_URL entre Postgres local et Scaleway (voir
 * docs/data-dictionary.md, section documents) :
 *   - absentes → disque local chiffré (DOCUMENTS_STORAGE_DIR, comportement
 *     dev historique, inchangé)
 *   - présentes → bucket Scaleway Object Storage (S3-compatible)
 *
 * `chemin` (construit par construireCheminStockage) sert à la fois de clé
 * S3 et de chemin relatif sur disque — même valeur stockée dans
 * documents.chemin_stockage quel que soit le backend actif.
 */
@Injectable()
export class DocumentStorageService {
  private readonly localStorageDir: string | null = null;
  private readonly s3: ConfigurationS3 | null = null;

  constructor(
    private readonly encryptionService: EncryptionService,
    config: ConfigService
  ) {
    const accessKeyId = config.get<string>("OBJECT_STORAGE_ACCESS_KEY");
    const secretAccessKey = config.get<string>("OBJECT_STORAGE_SECRET_KEY");
    const bucket = config.get<string>("OBJECT_STORAGE_BUCKET_NAME");

    if (accessKeyId && secretAccessKey && bucket) {
      this.s3 = {
        bucket,
        client: new S3Client({
          region: SCALEWAY_REGION,
          endpoint: `https://s3.${SCALEWAY_REGION}.scw.cloud`,
          credentials: { accessKeyId, secretAccessKey }
        })
      };
    } else {
      this.localStorageDir =
        config.get<string>("DOCUMENTS_STORAGE_DIR") ?? path.join(process.cwd(), "storage", "documents");
    }
  }

  // `chiffrer` (défaut true) : à désactiver uniquement pour un fichier de
  // référence public, partagé par toute l'app, sans donnée utilisateur
  // (ex. notice d'information légale — voir ReferencesService) — jamais
  // pour un document rattaché à une entité (bail/locataire/etc.), toujours
  // chiffré comme aujourd'hui.
  async enregistrer(contenu: Buffer, chemin: string, options?: { chiffrer?: boolean }): Promise<string> {
    const chiffrer = options?.chiffrer ?? true;
    const donnees = chiffrer ? this.encryptionService.encryptBuffer(contenu) : contenu;
    if (this.s3) {
      await this.s3.client.send(new PutObjectCommand({ Bucket: this.s3.bucket, Key: chemin, Body: donnees }));
    } else {
      const cheminAbsolu = path.join(this.localStorageDir!, chemin);
      await mkdir(path.dirname(cheminAbsolu), { recursive: true });
      await writeFile(cheminAbsolu, donnees);
    }
    return chemin;
  }

  async lire(chemin: string, options?: { chiffrer?: boolean }): Promise<Buffer> {
    const chiffrer = options?.chiffrer ?? true;
    let donnees: Buffer;
    if (this.s3) {
      const reponse = await this.s3.client.send(new GetObjectCommand({ Bucket: this.s3.bucket, Key: chemin }));
      if (!reponse.Body) {
        throw new Error(`Objet vide reçu du bucket pour la clé ${chemin}`);
      }
      donnees = Buffer.from(await reponse.Body.transformToByteArray());
    } else {
      donnees = await readFile(path.join(this.localStorageDir!, chemin));
    }
    return chiffrer ? this.encryptionService.decryptBuffer(donnees) : donnees;
  }
}
