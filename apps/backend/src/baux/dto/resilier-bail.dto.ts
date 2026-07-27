import { IsDateString, IsOptional } from "class-validator";

export class ResilierBailDto {
  @IsOptional()
  @IsDateString()
  dateFin?: string;
}
