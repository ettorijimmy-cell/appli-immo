import { Transform } from "class-transformer";
import { IsNumberString } from "class-validator";
import { normaliserMontant } from "core";

export class AppliquerRevisionDto {
  @Transform(({ value }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  nouveauLoyerValide!: string;
}
