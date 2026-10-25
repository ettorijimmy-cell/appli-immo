import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBase64,
  IsBoolean,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested
} from "class-validator";

// Nom du bailleur modifiable (cas du mandataire) : toujours reçu dans la
// requête, jamais résolu côté serveur depuis scis.nom_gerant/
// bien.nom_proprietaire — voir docs/data-dictionary.md, section
// etat_des_lieux_signature. Les éventuels défauts d'affichage côté mobile
// (pré-remplissage) sont du ressort de l'écran, pas de cet endpoint.
export class SignataireBailleurDto {
  @IsString()
  @IsNotEmpty()
  nomAffiche!: string;

  @IsBoolean()
  luEtApprouve!: boolean;

  // PNG en base64 — décodé et revalidé (taille, format réel) par
  // decoderEtValiderImageSignature, jamais seulement sur la foi de ce
  // décorateur (qui ne vérifie que la syntaxe base64).
  @IsBase64()
  imagePng!: string;
}

// Nom du locataire jamais reçu ici, contrairement au bailleur : résolu
// côté serveur depuis locataires.nom/prenom (bail_locataires actif),
// aucune raison métier de l'accepter en entrée.
export class SignataireLocataireDto {
  @IsUUID()
  locataireId!: string;

  @IsBoolean()
  luEtApprouve!: boolean;

  @IsBase64()
  imagePng!: string;
}

export class SignerEtatDesLieuxDto {
  // "Fait à ..." — optionnel, défaut bien.ville si absent/vide (voir
  // EtatsDesLieuxSignatureService).
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  lieu?: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => SignataireBailleurDto)
  bailleur!: SignataireBailleurDto;

  @IsArray()
  @ArrayUnique((signataire: SignataireLocataireDto) => signataire.locataireId)
  @ValidateNested({ each: true })
  @Type(() => SignataireLocataireDto)
  locataires!: SignataireLocataireDto[];
}
