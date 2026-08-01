import { IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Min, MinLength } from "class-validator";

const APPARTEMENT_TYPES = ["T1", "T2", "T3", "T4", "T5", "T6"] as const;
const MODES_PRODUCTION = ["individuel", "collectif"] as const;

export class CreateAppartementDto {
  @IsUUID()
  immeubleId!: string;

  @IsString()
  @MinLength(1)
  numero!: string;

  @IsIn(APPARTEMENT_TYPES)
  type!: (typeof APPARTEMENT_TYPES)[number];

  @IsOptional()
  @IsNumberString()
  surface?: string;

  @IsOptional()
  @IsNumberString()
  loyerReference?: string;

  // Connus dès la création du lot, contrairement à
  // identifiant_fiscal/equipement_cuisine/dependances_annexes (restés
  // facultatifs). Obligatoire uniquement à la création : le schéma reste
  // nullable, les appartements déjà créés avant ce durcissement ne sont
  // jamais forcés rétroactivement (docs/data-dictionary.md).
  @IsInt()
  @Min(1)
  nombrePiecesPrincipales!: number;

  @IsIn(MODES_PRODUCTION)
  modeChauffage!: (typeof MODES_PRODUCTION)[number];

  @IsIn(MODES_PRODUCTION)
  modeEauChaude!: (typeof MODES_PRODUCTION)[number];
}
