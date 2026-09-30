import { Type } from "class-transformer";
import { IsInt, IsUUID, Max, Min } from "class-validator";

export class Formulaire2044QueryDto {
  @IsUUID()
  bienId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  annee!: number;
}
