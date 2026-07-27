import { IsDateString, IsIn, IsNumberString, IsOptional } from "class-validator";

const BAIL_TYPES = ["vide", "meuble"] as const;

// Volontairement AUCUN champ `statut` ici : les transitions de statut d'un
// bail passent exclusivement par les endpoints dédiés (activer / résilier /
// archiver, voir BauxController), qui déclenchent aussi la transition
// automatique du statut de l'appartement. Un update() générique ne doit
// jamais pouvoir contourner cette règle par inadvertance.
export class UpdateBailDto {
  @IsOptional()
  @IsIn(BAIL_TYPES)
  typeBail?: (typeof BAIL_TYPES)[number];

  @IsOptional()
  @IsDateString()
  dateDebut?: string;

  @IsOptional()
  @IsDateString()
  dateFin?: string;

  @IsOptional()
  @IsNumberString()
  loyerMensuel?: string;

  @IsOptional()
  @IsNumberString()
  depotGarantie?: string;
}
