import { IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class CreateImmeubleDto {
  @IsUUID()
  sciId!: string;

  @IsString()
  @MinLength(1)
  nom!: string;

  @IsString()
  @MinLength(1)
  adresse!: string;

  @IsOptional()
  @IsString()
  codePostal?: string;

  @IsOptional()
  @IsString()
  ville?: string;
}
