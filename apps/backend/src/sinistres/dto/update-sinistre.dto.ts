import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches } from "class-validator";
import { normaliserMontant } from "core";
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
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "montantReclame doit être un nombre positif" })
  montantReclame?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "montantIndemnise doit être un nombre positif" })
  montantIndemnise?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "franchise doit être un nombre positif" })
  franchise?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
