import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";
import { MontantPositifOuNulOptionnel } from "./montant-positif-ou-nul-optionnel.decorator";

export const CANDIDAT_STATUTS = ["en_attente", "valide", "refuse", "converti"] as const;
export type CandidatStatut = (typeof CANDIDAT_STATUTS)[number];

export class CreateCandidatDto {
  @IsString()
  @MinLength(1)
  nom!: string;

  @IsString()
  @MinLength(1)
  prenom!: string;

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
