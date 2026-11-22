import { IsOptional, ValidateIf } from "class-validator";
import { MontantSaisi } from "../../common/montant-saisi.decorator";

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
// du projet). Bornes des montants (petites suites, décision 3) : >= 0.
export class SaisieManuelleAnnexe1Dto {
  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @MontantSaisi("ligne 2 de l'annexe 1", "positif_ou_nul")
  ligne2?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @MontantSaisi("ligne 3 de l'annexe 1", "positif_ou_nul")
  ligne3?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @MontantSaisi("ligne 4 de l'annexe 1", "positif_ou_nul")
  ligne4?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @MontantSaisi("ligne 9 bis de l'annexe 1", "positif_ou_nul")
  ligne9Bis?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @MontantSaisi("ligne 10 de l'annexe 1", "positif_ou_nul")
  ligne10?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @MontantSaisi("ligne 11 de l'annexe 1", "positif_ou_nul")
  ligne11?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @MontantSaisi("ligne 14 de l'annexe 1", "positif_ou_nul")
  ligne14?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @MontantSaisi("ligne 15 de l'annexe 1", "positif_ou_nul")
  ligne15?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @MontantSaisi("ligne 19 de l'annexe 1", "positif_ou_nul")
  ligne19?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @MontantSaisi("ligne 20 de l'annexe 1", "positif_ou_nul")
  ligne20?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => !champAbsent(value))
  @MontantSaisi("ligne 22 de l'annexe 1", "positif_ou_nul")
  ligne22?: string | null;
}
