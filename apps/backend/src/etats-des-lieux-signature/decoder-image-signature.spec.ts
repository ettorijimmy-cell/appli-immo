import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { decoderEtValiderImageSignature, TAILLE_MAX_IMAGE_SIGNATURE_OCTETS } from "./decoder-image-signature";

// PNG 1x1 valide minimal (en-tête + IHDR + IDAT + IEND réels), réutilisé
// dans plusieurs tests de ce fichier.
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("decoderEtValiderImageSignature", () => {
  it("accepte un PNG valide et renvoie le buffer décodé", () => {
    const buffer = decoderEtValiderImageSignature(PNG_1X1_BASE64, "le bailleur");
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("rejette une chaîne vide", () => {
    expect(() => decoderEtValiderImageSignature("", "le bailleur")).toThrow(BadRequestException);
  });

  it("rejette un contenu qui n'est pas un PNG (mauvaise signature d'octets)", () => {
    const fauxPng = Buffer.from("ceci n'est pas un PNG, juste du texte assez long").toString("base64");
    expect(() => decoderEtValiderImageSignature(fauxPng, "Jean Dupont")).toThrow(BadRequestException);
    try {
      decoderEtValiderImageSignature(fauxPng, "Jean Dupont");
    } catch (erreur) {
      expect((erreur as BadRequestException).message).toContain("Jean Dupont");
      expect((erreur as BadRequestException).message).toContain("PNG");
    }
  });

  it("rejette un PNG dont la taille décodée dépasse la limite (512 Ko)", () => {
    // Préfixe PNG valide suivi de remplissage — seule la taille doit être
    // rejetée, pas le format (vérifié par l'ordre des contrôles dans
    // decoderEtValiderImageSignature : taille avant format n'a pas
    // d'importance ici puisque les deux échouent, mais on vérifie que le
    // message mentionne bien la taille).
    const enTetePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const remplissage = Buffer.alloc(TAILLE_MAX_IMAGE_SIGNATURE_OCTETS + 1, 0);
    const buffer = Buffer.concat([enTetePng, remplissage]);
    expect(() => decoderEtValiderImageSignature(buffer.toString("base64"), "le bailleur")).toThrow(BadRequestException);
    try {
      decoderEtValiderImageSignature(buffer.toString("base64"), "le bailleur");
    } catch (erreur) {
      expect((erreur as BadRequestException).message).toContain("volumineuse");
    }
  });

  it("accepte une image pile à la limite de 512 Ko", () => {
    const enTetePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const remplissage = Buffer.alloc(TAILLE_MAX_IMAGE_SIGNATURE_OCTETS - enTetePng.length, 0);
    const buffer = Buffer.concat([enTetePng, remplissage]);
    expect(buffer.length).toBe(TAILLE_MAX_IMAGE_SIGNATURE_OCTETS);
    expect(() => decoderEtValiderImageSignature(buffer.toString("base64"), "le bailleur")).not.toThrow();
  });
});
