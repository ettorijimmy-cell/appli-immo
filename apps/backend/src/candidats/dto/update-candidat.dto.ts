import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";
import { CANDIDAT_STATUTS, type CandidatStatut } from "./create-candidat.dto";
import { MontantPositifOuNulOptionnel } from "./montant-positif-ou-nul-optionnel.decorator";

export class UpdateCandidatDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nom?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  prenom?: string;

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

  @MontantPositifOuNulOptionnel("revenu mensuel net")
  revenuMensuelNet?: string;

  @MontantPositifOuNulOptionnel("loyer visé")
  loyerVise?: string;

  @IsOptional()
  @IsString()
  situationProfessionnelle?: string;

  @IsOptional()
  @IsString()
  garantNom?: string;

  @MontantPositifOuNulOptionnel("revenu mensuel net du garant")
  garantRevenuMensuelNet?: string;
}
