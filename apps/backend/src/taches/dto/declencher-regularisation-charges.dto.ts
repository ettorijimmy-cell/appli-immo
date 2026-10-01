import { IsDateString } from "class-validator";

// Bornes explicites, jamais calculées implicitement depuis la date du jour
// (décision actée avec l'utilisateur, Module Régularisation des charges,
// Sous-commit C) : un déclenchement manuel sert aussi à un départ de
// locataire avant la première année, période qui ne peut pas se deviner.
export class DeclencherRegularisationChargesDto {
  @IsDateString()
  periodeDebut!: string;

  @IsDateString()
  periodeFin!: string;
}
