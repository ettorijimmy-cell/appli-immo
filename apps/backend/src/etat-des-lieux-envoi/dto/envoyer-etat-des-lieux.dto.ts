import { Type } from "class-transformer";
import { ArrayMinSize, ArrayUnique, IsArray, IsString, IsUUID, ValidateNested } from "class-validator";

export class DestinataireEnvoiDto {
  @IsUUID()
  locataireId!: string;

  // Adresse affichée à la confirmation. Validée par le service, qui connaît
  // le nom du locataire pour un message d'erreur exploitable, et comparée à
  // la fiche : le mail ne part jamais vers une adresse que l'utilisateur
  // n'a pas vue.
  @IsString()
  email!: string;
}

export class EnvoyerEtatDesLieuxDto {
  // Générée à la confirmation. La rejouer ne renvoie aucun mail.
  @IsUUID()
  demandeId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((destinataire: DestinataireEnvoiDto) => destinataire.locataireId)
  @ValidateNested({ each: true })
  @Type(() => DestinataireEnvoiDto)
  destinataires!: DestinataireEnvoiDto[];
}
