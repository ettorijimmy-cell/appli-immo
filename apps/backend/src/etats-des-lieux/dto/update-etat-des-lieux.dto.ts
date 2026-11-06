import { IsDateString, IsOptional, IsString } from "class-validator";

export class UpdateEtatDesLieuxDto {
  // Décision 11 (2026-11-06) : plus de saisie libre. dateEntree est posée
  // par la signature d'entrée ou la déclaration d'entrée papier, dateSortie
  // par la signature de sortie. Les deux champs restent déclarés ici
  // uniquement pour être REFUSÉS explicitement par
  // EtatsDesLieuxService.updateHeader : le ValidationPipe (whitelist) les
  // supprimerait sinon en silence, et un ancien client croirait la date
  // enregistrée.
  @IsOptional()
  @IsDateString()
  dateEntree?: string;

  @IsOptional()
  @IsDateString()
  dateSortie?: string;

  // Décret n° 2016-382, art. 2, 2° a — connu uniquement à la sortie,
  // jamais à l'entrée. Texte libre, décision assumée.
  @IsOptional()
  @IsString()
  nouvelleAdresseLocataire?: string;
}
