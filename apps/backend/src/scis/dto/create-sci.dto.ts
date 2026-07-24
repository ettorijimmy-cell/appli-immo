import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class CreateSciDto {
  @IsString()
  @MinLength(1)
  nom!: string;

  @IsIn(["IS", "IR"])
  regimeFiscal!: "IS" | "IR";

  @IsOptional()
  @IsString()
  formeJuridique?: string;

  @IsOptional()
  @IsString()
  siret?: string;
}
