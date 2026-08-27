import { IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Min, MinLength } from "class-validator";

const APPARTEMENT_TYPES = ["T1", "T2", "T3", "T4", "T5", "T6"] as const;
const MODES_PRODUCTION = ["individuel", "collectif"] as const;
const TYPES_ENERGIE = ["electrique", "gaz", "les_deux"] as const;

export class CreateAppartementDto {
  @IsUUID()
  bienId!: string;

  @IsString()
  @MinLength(1)
  numero!: string;

  // type/nombrePiecesPrincipales/modeChauffage/modeEauChaude/typeEnergie :
  // mentions du contrat-type résidentiel (décret n° 2015-587), sans objet
  // pour un bien non résidentiel (parking/bureau/local_commercial — voir
  // packages/core, estTypeResidentiel). Optionnels ici au niveau de la
  // forme : le caractère obligatoire (bien résidentiel) ou interdit (bien
  // non résidentiel) dépend du type du bien parent, résolu et vérifié dans
  // AppartementsService.create() — audit du 2026-08-27, docs/backlog.md.
  @IsOptional()
  @IsIn(APPARTEMENT_TYPES)
  type?: (typeof APPARTEMENT_TYPES)[number];

  @IsOptional()
  @IsNumberString()
  surface?: string;

  @IsOptional()
  @IsNumberString()
  loyerReference?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  nombrePiecesPrincipales?: number;

  @IsOptional()
  @IsIn(MODES_PRODUCTION)
  modeChauffage?: (typeof MODES_PRODUCTION)[number];

  @IsOptional()
  @IsIn(MODES_PRODUCTION)
  modeEauChaude?: (typeof MODES_PRODUCTION)[number];

  @IsOptional()
  @IsIn(TYPES_ENERGIE)
  typeEnergie?: (typeof TYPES_ENERGIE)[number];
}
