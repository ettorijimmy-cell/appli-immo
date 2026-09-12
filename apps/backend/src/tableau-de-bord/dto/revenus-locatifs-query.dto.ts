import { IsOptional, IsUUID } from "class-validator";
import { PeriodeQueryDto } from "./periode-query.dto";

// Module Charges et fiscalité, Étape 3 (docs/backlog.md) : filtre bien/SCI
// sur le cockpit "Comptabilité" — propre à cette route, pas ajouté à
// PeriodeQueryDto (partagé avec /tableau-de-bord/synthese, sans besoin de
// ce filtre).
export class RevenusLocatifsQueryDto extends PeriodeQueryDto {
  @IsOptional()
  @IsUUID()
  bienId?: string;

  @IsOptional()
  @IsUUID()
  sciId?: string;
}
