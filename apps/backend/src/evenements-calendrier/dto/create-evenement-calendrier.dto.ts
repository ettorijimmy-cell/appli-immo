import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export const EVENEMENT_TYPES = ["intervention_artisan", "visite_candidat", "etat_des_lieux", "autre"] as const;
export type EvenementType = (typeof EVENEMENT_TYPES)[number];

// bienId/appartementId/contactId/candidatId sont tous indépendamment
// optionnels — aucune contrainte au niveau schéma ni DTO liant un `type`
// donné à un rattachement obligatoire (ex. visite_candidat n'impose pas
// candidatId), laissé à l'appréciation de l'utilisateur au moment de la
// saisie plutôt qu'une rigidité prématurée (voir packages/db/src/schema/
// evenement-calendrier.ts).
export class CreateEvenementCalendrierDto {
  @IsIn(EVENEMENT_TYPES)
  type!: EvenementType;

  @IsString()
  @MinLength(1)
  titre!: string;

  @IsDateString()
  dateDebut!: string;

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
  @IsString()
  notes?: string;
}
