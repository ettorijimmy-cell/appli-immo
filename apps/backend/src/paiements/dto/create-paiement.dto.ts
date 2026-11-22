import { IsDateString, IsIn, IsUUID } from "class-validator";
import { MontantSaisi } from "../../common/montant-saisi.decorator";

const PAIEMENT_TYPES = ["loyer", "charges", "depot_garantie"] as const;

export class CreatePaiementDto {
  @IsUUID()
  bailId!: string;

  @IsIn(PAIEMENT_TYPES)
  type!: (typeof PAIEMENT_TYPES)[number];

  // Strictement positif (petites suites, décision 3). Normalisé
  // virgule/point/espaces avant la validation par normaliserMontant
  // (packages/core) — seule définition de "comment interpréter un montant
  // en euros", partagée avec le rapprochement CSV
  // (apps/desktop/src/renderer/src/finances/RapprochementCsvView.tsx).
  @MontantSaisi("montant de l'échéance", "strictement_positif")
  montant!: string;

  @IsDateString()
  dateEcheance!: string;
}
