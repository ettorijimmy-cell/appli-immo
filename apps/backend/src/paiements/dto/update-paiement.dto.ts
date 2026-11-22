import { IsDateString, IsIn, IsOptional } from "class-validator";
import { MontantSaisi } from "../../common/montant-saisi.decorator";

const PAIEMENT_TYPES = ["loyer", "charges", "depot_garantie"] as const;

// Volontairement AUCUN champ statut ici : il est toujours recalculé par
// PaiementsService depuis les versements actifs (voir VersementsService),
// jamais saisi directement — même principe de défense en profondeur que
// UpdateBailDto (Module 3). montant_paye/mode/date_paiement/
// reference_rapprochement n'existent plus du tout sur paiements depuis la
// Phase 3 du chantier "versements & remboursements"
// (docs/data-dictionary.md).
export class UpdatePaiementDto {
  @IsOptional()
  @IsIn(PAIEMENT_TYPES)
  type?: (typeof PAIEMENT_TYPES)[number];

  // Strictement positif, comme à la création (petites suites, décision 3).
  @IsOptional()
  @MontantSaisi("montant de l'échéance", "strictement_positif")
  montant?: string;

  @IsOptional()
  @IsDateString()
  dateEcheance?: string;
}
