import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";
import { CANDIDAT_STATUTS, type CandidatStatut } from "./create-candidat.dto";
import { MontantPositifOptionnel } from "./montant-positif-optionnel.decorator";

export class UpdateCandidatDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nom?: string;

  @IsOptional()
  @IsString()
  telephone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsUUID()
  appartementId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(CANDIDAT_STATUTS)
  statut?: CandidatStatut;

  @MontantPositifOptionnel()
  revenuMensuelNet?: string;

  @MontantPositifOptionnel()
  loyerVise?: string;

  @IsOptional()
  @IsString()
  situationProfessionnelle?: string;

  @IsOptional()
  @IsString()
  garantNom?: string;

  @MontantPositifOptionnel()
  garantRevenuMensuelNet?: string;
}
