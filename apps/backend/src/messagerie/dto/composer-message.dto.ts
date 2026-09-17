import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export type ClassificationTypeChoisie = "contact" | "locataire" | "candidat" | "garant";

const TYPES_CLASSIFICATION_CHOISIE: ClassificationTypeChoisie[] = ["contact", "locataire", "candidat", "garant"];

// Composition libre hors du flux Tâches (Module Messagerie, 2026-09-16).
// Par défaut, la classification (contact/locataire/candidat/garant/
// non_classe) est résolue automatiquement par SmtpEnvoiService à partir de
// l'adresse destinataire — même mécanisme que pour les messages reçus.
// classificationType/classificationId sont désormais optionnels : quand le
// destinataire est choisi depuis le Carnet de contacts (sélecteur
// desktop, 2026-09-16), l'appelant connaît déjà l'entité exacte et n'a pas
// besoin d'attendre une correspondance d'adresse a posteriori — voir
// SmtpEnvoiService.envoyerEmail. Les deux champs sont liés : soit aucun
// des deux (résolution automatique), soit les deux (classification
// immédiate) — jamais un seul ; la cohérence des deux ensemble est
// vérifiée par MessagesCommunicationService.composer (pas exprimable
// proprement avec class-validator seul dans les deux sens à la fois).
export class ComposerMessageDto {
  @IsEmail()
  destinataire!: string;

  @IsString()
  @MinLength(1)
  objet!: string;

  @IsString()
  @MinLength(1)
  corps!: string;

  @IsOptional()
  @IsIn(TYPES_CLASSIFICATION_CHOISIE)
  classificationType?: ClassificationTypeChoisie;

  @IsOptional()
  @IsUUID()
  classificationId?: string;
}
