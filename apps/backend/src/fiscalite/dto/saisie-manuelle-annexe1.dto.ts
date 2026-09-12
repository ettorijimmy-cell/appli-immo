import { Transform } from "class-transformer";
import { IsNumberString, IsOptional, Matches, ValidateIf } from "class-validator";
import { normaliserMontant } from "core";

// Une chaîne vide ou null vaut "effacer la valeur saisie" (colonne remise à
// NULL, traitée comme 0 dans calculerAnnexe1) — undefined (champ absent du
// corps PATCH) laisse la valeur existante inchangée. Voir
// FiscaliteService.sauvegarderSaisieManuelle.
const champAbsent = (value: unknown): boolean => value === null || value === undefined || value === "";

// 11 lignes de l'Annexe 1 (2072-S-A1-SD) trop spécifiques pour être
// dérivées automatiquement — voir packages/core/src/fiscalite/
// calculer-annexe1.ts, Annexe1SaisieManuelle. Toutes optionnelles et
// indépendantes (répétition volontaire plutôt qu'une abstraction générique
// sur 11 champs quasi identiques, cohérent avec le style du reste des DTOs
// du projet).
export class SaisieManuelleAnnexe1Dto {
  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "ligne2 doit être un nombre positif" })
  ligne2?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "ligne3 doit être un nombre positif" })
  ligne3?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "ligne4 doit être un nombre positif" })
  ligne4?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "ligne9Bis doit être un nombre positif" })
  ligne9Bis?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "ligne10 doit être un nombre positif" })
  ligne10?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "ligne11 doit être un nombre positif" })
  ligne11?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "ligne14 doit être un nombre positif" })
  ligne14?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "ligne15 doit être un nombre positif" })
  ligne15?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "ligne19 doit être un nombre positif" })
  ligne19?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "ligne20 doit être un nombre positif" })
  ligne20?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "ligne22 doit être un nombre positif" })
  ligne22?: string | null;
}
