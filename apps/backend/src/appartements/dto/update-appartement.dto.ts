import { IsIn, IsNumberString, IsOptional, IsString, MinLength } from "class-validator";

const APPARTEMENT_TYPES = ["T1", "T2", "T3", "T4", "T5+"] as const;

export class UpdateAppartementDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  numero?: string;

  @IsOptional()
  @IsIn(APPARTEMENT_TYPES)
  type?: (typeof APPARTEMENT_TYPES)[number];

  @IsOptional()
  @IsNumberString()
  surface?: string;

  @IsOptional()
  @IsNumberString()
  loyerReference?: string;
}
