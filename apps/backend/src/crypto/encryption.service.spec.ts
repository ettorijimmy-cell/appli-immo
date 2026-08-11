import { randomBytes } from "crypto";
import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it } from "vitest";
import { EncryptionService } from "./encryption.service";

function buildService(): EncryptionService {
  const config = { get: () => undefined } as unknown as ConfigService;
  return new EncryptionService(config);
}

function buildConfig(encryptionKey: string | undefined): ConfigService {
  return { get: () => encryptionKey } as unknown as ConfigService;
}

describe("EncryptionService — garde-fou production (ENCRYPTION_KEY)", () => {
  const NODE_ENV_ORIGINAL = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = NODE_ENV_ORIGINAL;
  });

  it("échoue au démarrage si NODE_ENV=production et ENCRYPTION_KEY absente", () => {
    process.env.NODE_ENV = "production";

    expect(() => new EncryptionService(buildConfig(undefined))).toThrow(/ENCRYPTION_KEY doit être définie en production/);
  });

  it("démarre normalement et chiffre/déchiffre si NODE_ENV=production et ENCRYPTION_KEY définie", () => {
    process.env.NODE_ENV = "production";
    const cle = randomBytes(32).toString("base64");

    const service = new EncryptionService(buildConfig(cle));
    const chiffre = service.encrypt("FR7630006000011234567890189");

    expect(service.decrypt(chiffre)).toBe("FR7630006000011234567890189");
  });

  it("hors production, retombe sur la clé de développement sans erreur si ENCRYPTION_KEY absente", () => {
    process.env.NODE_ENV = "test";

    expect(() => new EncryptionService(buildConfig(undefined))).not.toThrow();
  });
});

describe("EncryptionService", () => {
  it("chiffre puis déchiffre pour retrouver la valeur d'origine", () => {
    const service = buildService();
    const plaintext = "FR7630006000011234567890189";

    const ciphertext = service.encrypt(plaintext);

    expect(ciphertext).not.toBe(plaintext);
    expect(service.decrypt(ciphertext)).toBe(plaintext);
  });

  it("produit un chiffré différent à chaque appel (IV aléatoire)", () => {
    const service = buildService();
    const plaintext = "FR7630006000011234567890189";

    expect(service.encrypt(plaintext)).not.toBe(service.encrypt(plaintext));
  });

  it("échoue si le tag d'authentification est altéré", () => {
    const service = buildService();
    const ciphertext = service.encrypt("secret");
    const [iv, authTag, data] = ciphertext.split(":");
    const tampered = [iv, `${authTag!.slice(0, -2)}AA`, data].join(":");

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it("encryptBuffer puis decryptBuffer retrouve le buffer d'origine (binaire quelconque)", () => {
    const service = buildService();
    const plaintext = Buffer.from([0, 1, 2, 255, 254, 253, 10, 13, 0]);

    const ciphertext = service.encryptBuffer(plaintext);

    expect(ciphertext.equals(plaintext)).toBe(false);
    expect(service.decryptBuffer(ciphertext).equals(plaintext)).toBe(true);
  });

  it("encryptBuffer produit un chiffré différent à chaque appel (IV aléatoire)", () => {
    const service = buildService();
    const plaintext = Buffer.from("contenu de fichier");

    expect(service.encryptBuffer(plaintext).equals(service.encryptBuffer(plaintext))).toBe(false);
  });

  it("decryptBuffer échoue si le contenu chiffré est altéré", () => {
    const service = buildService();
    const ciphertext = service.encryptBuffer(Buffer.from("contenu de fichier"));
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! ^ 0xff) & 0xff;

    expect(() => service.decryptBuffer(tampered)).toThrow();
  });
});
