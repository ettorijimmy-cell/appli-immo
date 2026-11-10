import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { UpdateGarantDto } from "./update-garant.dto";

// Point 6a (docs/backlog.md) : dateNaissance/lieuNaissance/nationalite
// doivent accepter `null` (champ à effacer, voir EditGarantForm desktop)
// aussi bien que `undefined` (clé absente, champ non modifié) — @IsOptional()
// de class-validator saute la validation dans les deux cas, contrairement à
// une simple chaîne vide qui resterait soumise aux validateurs (@IsEmail,
// @IsDateString...).
describe("UpdateGarantDto", () => {
  it("nom vide est rejeté (MinLength(1))", async () => {
    const dto = plainToInstance(UpdateGarantDto, { nom: "" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nom")).toBe(true);
  });

  it("nom absent (non fourni) ne déclenche aucune erreur", async () => {
    const dto = plainToInstance(UpdateGarantDto, {});
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nom")).toBe(false);
  });

  // @ValidateIf (pas @IsOptional) : un `null` explicite doit être
  // réellement rejeté plutôt que traité comme "absent" — sans quoi la
  // requête atteindrait la contrainte NOT NULL de Postgres et remonterait
  // en 500 au lieu d'un 400 propre.
  it("nom null est rejeté — jamais effaçable", async () => {
    const dto = plainToInstance(UpdateGarantDto, { nom: null });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "nom")).toBe(true);
  });

  it("prenom null est rejeté — jamais effaçable", async () => {
    const dto = plainToInstance(UpdateGarantDto, { prenom: null });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "prenom")).toBe(true);
  });

  for (const champ of ["email", "telephone", "adresse", "codePostal", "ville", "dateNaissance", "lieuNaissance", "nationalite", "locataireId"]) {
    it(`${champ} accepte null (champ à effacer)`, async () => {
      const dto = plainToInstance(UpdateGarantDto, { [champ]: null });
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === champ)).toBe(false);
    });

    it(`${champ} absent (non fourni) ne déclenche aucune erreur`, async () => {
      const dto = plainToInstance(UpdateGarantDto, {});
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === champ)).toBe(false);
    });
  }

  it("email invalide (non vide, mal formé) reste rejeté malgré le typage nullable", async () => {
    const dto = plainToInstance(UpdateGarantDto, { email: "pas-un-email" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "email")).toBe(true);
  });

  it("dateNaissance invalide (non vide, mal formée) reste rejetée malgré le typage nullable", async () => {
    const dto = plainToInstance(UpdateGarantDto, { dateNaissance: "pas-une-date" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "dateNaissance")).toBe(true);
  });

  it("locataireId qui n'est pas un UUID est rejeté", async () => {
    const dto = plainToInstance(UpdateGarantDto, { locataireId: "pas-un-uuid" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "locataireId")).toBe(true);
  });

  it("adresse non textuelle est rejetée", async () => {
    const dto = plainToInstance(UpdateGarantDto, { adresse: 12, codePostal: 69001, ville: true });
    const erreurs = await validate(dto);
    expect(erreurs.map((e) => e.property).sort()).toEqual(["adresse", "codePostal", "ville"]);
  });

  // Chantier garants (2026-11-08) : « autre » n'est plus accepté à la saisie.
  it("typeGarantie accepte personne_physique et garantie_visale", async () => {
    for (const valeur of ["personne_physique", "garantie_visale"]) {
      const dto = plainToInstance(UpdateGarantDto, { typeGarantie: valeur });
      const erreurs = await validate(dto);
      expect(erreurs.some((e) => e.property === "typeGarantie")).toBe(false);
    }
  });

  it("typeGarantie refuse « autre », avec un message clair", async () => {
    const dto = plainToInstance(UpdateGarantDto, { typeGarantie: "autre" });
    const erreurs = await validate(dto);
    const erreur = erreurs.find((e) => e.property === "typeGarantie");
    expect(Object.values(erreur?.constraints ?? {})).toContain(
      "typeGarantie doit être personne_physique (caution) ou garantie_visale : le type « autre » n'est plus accepté"
    );
  });

  it("numeroContratVisale accepte une chaîne, null (effacer) ou l'absence, refuse un nombre", async () => {
    for (const valeur of ["V0001", null, undefined]) {
      const erreurs = await validate(plainToInstance(UpdateGarantDto, { numeroContratVisale: valeur }));
      expect(erreurs.some((e) => e.property === "numeroContratVisale")).toBe(false);
    }
    const erreurs = await validate(plainToInstance(UpdateGarantDto, { numeroContratVisale: 12 }));
    expect(erreurs.some((e) => e.property === "numeroContratVisale")).toBe(true);
  });

  it("typeGarantie rejette une valeur hors enum", async () => {
    const dto = plainToInstance(UpdateGarantDto, { typeGarantie: "autre_chose" });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === "typeGarantie")).toBe(true);
  });
});
