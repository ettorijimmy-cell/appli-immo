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
}
