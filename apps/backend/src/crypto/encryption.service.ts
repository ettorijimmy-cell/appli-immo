import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

// Clé de secours déterministe pour le développement local sans Secret
// Manager configuré — jamais utilisée si ENCRYPTION_KEY est renseignée.
const DEV_FALLBACK_KEY = createHash("sha256")
  .update("dev-only-insecure-encryption-key-change-me")
  .digest();

/**
 * Chiffrement applicatif AES-256-GCM des champs sensibles (IBAN, BIC...).
 * Voir CLAUDE.md, section Règles importantes : le déchiffrement ne doit
 * jamais s'exécuter côté apps/desktop, uniquement ici.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const keyBase64 = config.get<string>("ENCRYPTION_KEY");
    this.key = keyBase64 ? Buffer.from(keyBase64, "base64") : DEV_FALLBACK_KEY;
    if (this.key.length !== 32) {
      throw new Error("ENCRYPTION_KEY doit être une clé AES-256 encodée en base64 (32 octets)");
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
      ":"
    );
  }

  decrypt(payload: string): string {
    const [ivB64, authTagB64, ciphertextB64] = payload.split(":");
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      throw new Error("Payload chiffré malformé");
    }
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  }

  /**
   * Équivalent binaire de encrypt()/decrypt(), pour les fichiers (Module 4,
   * Documents) — évite le gonflement de taille d'un double passage par
   * base64 (encoder le buffer en base64 avant de le faire transiter par
   * encrypt(), qui base64-encode déjà sa sortie). Même clé, même algorithme,
   * IV en tête du buffer plutôt qu'un format `iv:authTag:ciphertext` textuel.
   */
  encryptBuffer(plaintext: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  decryptBuffer(payload: Buffer): Buffer {
    const AUTH_TAG_LENGTH = 16;
    if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error("Payload chiffré malformé");
    }
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
