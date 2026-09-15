import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";
import { EVENEMENT_TYPES, type EvenementType } from "./create-evenement-calendrier.dto";

export class UpdateEvenementCalendrierDto {
  @IsOptional()
  @IsIn(EVENEMENT_TYPES)
  type?: EvenementType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  titre?: string;

  @IsOptional()
  @IsDateString()
  dateDebut?: string;

  @IsOptional()
  @IsDateString()
  dateFin?: string;

  @IsOptional()
  @IsUUID()
  bienId?: string;

  @IsOptional()
  @IsUUID()
  appartementId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  candidatId?: string;

  @IsOptional()
  @IsUUID()
  sinistreId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
