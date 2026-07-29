import { IsDateString } from "class-validator";

export class PeriodeQueryDto {
  @IsDateString()
  debut!: string;

  @IsDateString()
  fin!: string;
}
