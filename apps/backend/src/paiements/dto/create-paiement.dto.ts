import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsNumberString, IsUUID } from "class-validator";
import { normaliserMontant } from "core";

const PAIEMENT_TYPES = ["loyer", "charges", "depot_garantie"] as const;

export class CreatePaiementDto {
  @IsUUID()
  bailId!: string;

  @IsIn(PAIEMENT_TYPES)
  type!: (typeof PAIEMENT_TYPES)[number];

  // Normalise virgule/point/espaces AVANT la validation (voir
  // normaliserMontant, packages/core) — seule définition de "comment
  // interpréter un montant en euros", partagée avec le rapprochement CSV
  // (apps/desktop/src/renderer/src/finances/RapprochementCsvView.tsx).
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  montant!: string;

  @IsDateString()
  dateEcheance!: string;
}
