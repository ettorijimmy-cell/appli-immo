import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from "class-validator";
import { MontantSaisi } from "../../common/montant-saisi.decorator";
import { SINISTRE_STATUTS, SINISTRE_TYPES, type SinistreStatut, type SinistreType } from "./create-sinistre.dto";

export class UpdateSinistreDto {
  @IsOptional()
  @IsIn(SINISTRE_TYPES)
  type?: SinistreType;

  // Si fourni et différent du statut actuel, SinistresService.update()
  // met à jour dateChangementStatut à `now()` — jamais si identique à
  // l'actuel (voir data-dictionary.md, section sinistre).
  @IsOptional()
  @IsIn(SINISTRE_STATUTS)
  statut?: SinistreStatut;

  @IsOptional()
  @IsUUID()
  bienId?: string;

  @IsOptional()
  @IsUUID()
  appartementId?: string;

  @IsOptional()
  @IsUUID()
  contactAssureurId?: string;

  @IsOptional()
  @IsDateString()
  dateDeclaration?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @MontantSaisi("montant réclamé", "positif_ou_nul")
  montantReclame?: string;

  @IsOptional()
  @MontantSaisi("montant indemnisé", "positif_ou_nul")
  montantIndemnise?: string;

  @IsOptional()
  @MontantSaisi("franchise", "positif_ou_nul")
  franchise?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
