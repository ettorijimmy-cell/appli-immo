import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateSciDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nom?: string;

  @IsOptional()
  @IsIn(["IS", "IR"])
  regimeFiscal?: "IS" | "IR";

  @IsOptional()
  @IsString()
  formeJuridique?: string;

  @IsOptional()
  @IsString()
  siret?: string;
}
