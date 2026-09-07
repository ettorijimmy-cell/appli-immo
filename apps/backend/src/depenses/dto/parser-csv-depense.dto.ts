import { IsString, MinLength } from "class-validator";

export class ParserCsvDepenseDto {
  @IsString()
  @MinLength(1)
  contenuCsv!: string;
}
