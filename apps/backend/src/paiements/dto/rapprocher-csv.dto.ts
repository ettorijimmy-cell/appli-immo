import { IsString, MinLength } from "class-validator";

export class RapprocherCsvDto {
  @IsString()
  @MinLength(1)
  contenuCsv!: string;
}
