import { IsEmail, IsString, MinLength } from "class-validator";

// Composition libre hors du flux Tâches (Module Messagerie, 2026-09-16) :
// la classification (contact/locataire/candidat/non_classe) est résolue
// automatiquement par SmtpEnvoiService à partir de l'adresse destinataire,
// jamais saisie manuellement ici — même mécanisme que pour les messages
// reçus, cohérent sur tout l'écran Messagerie.
export class ComposerMessageDto {
  @IsEmail()
  destinataire!: string;

  @IsString()
  @MinLength(1)
  objet!: string;

  @IsString()
  @MinLength(1)
  corps!: string;
}
