// Nécessaire explicitement ici (contrairement aux autres *.dto.spec.ts
// de ce dépôt, qui n'utilisent pas @ValidateNested) : le polyfill n'est
// chargé qu'une fois par main.ts en production, jamais par vitest seul
// — sans cet import, @Type(() => X) sur une classe imbriquée échoue avec
// "Reflect.getMetadata is not a function" quand ce fichier tourne en
// isolation (le run complet masque le problème : un autre fichier de
// test, ex. app.module.spec.ts, importe déjà reflect-metadata avant).
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { SignerEtatDesLieuxDto } from "./signer-etat-des-lieux.dto";

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const CHAMPS_VALIDES = {
  bailleur: { nomAffiche: "Jimmy Ettori", luEtApprouve: true, imagePng: PNG_1X1_BASE64 },
  locataires: [{ locataireId: "018f1e3a-0000-7000-8000-000000000001", luEtApprouve: true, imagePng: PNG_1X1_BASE64 }]
};

describe("SignerEtatDesLieuxDto", () => {
  it("accepte un corps valide, sans lieu (optionnel)", async () => {
    const dto = plainToInstance(SignerEtatDesLieuxDto, { ...CHAMPS_VALIDES });
    const erreurs = await validate(dto);
    expect(erreurs).toHaveLength(0);
  });

  it("accepte lieu quand fourni", async () => {
    const dto = plainToInstance(SignerEtatDesLieuxDto, { ...CHAMPS_VALIDES, lieu: "Paris" });
    const erreurs = await validate(dto);
    expect(erreurs).toHaveLength(0);
  });

  it("accepte une liste de locataires vide (bail sans locataire actif)", async () => {
    const dto = plainToInstance(SignerEtatDesLieuxDto, { ...CHAMPS_VALIDES, locataires: [] });
    const erreurs = await validate(dto);
    expect(erreurs).toHaveLength(0);
  });

  it("rejette l'absence de bailleur", async () => {
    const dto = plainToInstance(SignerEtatDesLieuxDto, { locataires: CHAMPS_VALIDES.locataires });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "bailleur")).toBe(true);
  });

  it("rejette luEtApprouve non booléen côté bailleur", async () => {
    const dto = plainToInstance(SignerEtatDesLieuxDto, {
      ...CHAMPS_VALIDES,
      bailleur: { ...CHAMPS_VALIDES.bailleur, luEtApprouve: "oui" }
    });
    const erreurs = await validate(dto, { whitelist: false });
    const erreurBailleur = erreurs.find((e) => e.property === "bailleur");
    expect(erreurBailleur?.children?.some((c) => c.property === "luEtApprouve")).toBe(true);
  });

  it("rejette une image qui n'est pas du base64 valide côté bailleur", async () => {
    const dto = plainToInstance(SignerEtatDesLieuxDto, {
      ...CHAMPS_VALIDES,
      bailleur: { ...CHAMPS_VALIDES.bailleur, imagePng: "pas du base64 !!" }
    });
    const erreurs = await validate(dto);
    const erreurBailleur = erreurs.find((e) => e.property === "bailleur");
    expect(erreurBailleur?.children?.some((c) => c.property === "imagePng")).toBe(true);
  });

  it("rejette un locataireId qui n'est pas un UUID", async () => {
    const dto = plainToInstance(SignerEtatDesLieuxDto, {
      ...CHAMPS_VALIDES,
      locataires: [{ locataireId: "pas-un-uuid", luEtApprouve: true, imagePng: PNG_1X1_BASE64 }]
    });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "locataires")).toBe(true);
  });

  it("rejette deux locataires avec le même locataireId (doublon)", async () => {
    const dto = plainToInstance(SignerEtatDesLieuxDto, {
      ...CHAMPS_VALIDES,
      locataires: [...CHAMPS_VALIDES.locataires, ...CHAMPS_VALIDES.locataires]
    });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "locataires")).toBe(true);
  });
});
