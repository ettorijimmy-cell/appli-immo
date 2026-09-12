import { Type } from "class-transformer";
import { IsInt, IsUUID, Max, Min } from "class-validator";

export class Annexe1QueryDto {
  @IsUUID()
  sciId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  annee!: number;
}
