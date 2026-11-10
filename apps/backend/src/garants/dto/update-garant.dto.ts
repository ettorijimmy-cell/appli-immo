import { IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength, ValidateIf } from "class-validator";
import { GARANT_TYPES_SAISISSABLES, MESSAGE_TYPE_GARANTIE_REFUSE, type GarantTypeSaisissable } from "./create-garant.dto";

export class UpdateGarantDto {
  // @ValidateIf (pas @IsOptional) : nom/prenom ne doivent jamais pouvoir
  // passer à null — colonnes NOT NULL en base (packages/db/src/schema/
  // garants.ts). @IsOptional() traite `null` comme "absent" et sauterait
  // @IsString/@MinLength, laissant passer un `nom: null` explicite malgré
  // son typage TS `string?` sans `| null` — la requête remonterait alors
  // jusqu'à une violation de contrainte Postgres NOT NULL, exposée en 500
  // au lieu d'un 400 propre (même correctif que numero sur
  // UpdateAppartementDto, point 6c, docs/backlog.md).
  @ValidateIf((o) => o.nom !== undefined)
  @IsString()
  @MinLength(1)
  nom?: string;

  @ValidateIf((o) => o.prenom !== undefined)
  @IsString()
  @MinLength(1)
  prenom?: string;

  // Champs optionnels nullable (pas seulement `?: string`) : @IsOptional()
  // saute la validation aussi bien pour `undefined` (clé absente du corps —
  // champ non modifié) que pour `null` (clé envoyée explicitement — champ
  // à effacer). Sans le type `| null`, TypeScript rejetterait l'appel côté
  // service qui transmet `null` pour vider le champ (desktop,
  // EditGarantForm) — même mécanisme que CreateGarantDto, étendu ici pour
  // permettre l'effacement après coup (CreateGarantDto n'a pas ce besoin,
  // rien n'existe encore à effacer à la création).
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  telephone?: string | null;

  // « autre » refusé (voir CreateGarantDto). Changement de type : voir
  // GarantsService.update.
  @IsOptional()
  @IsIn(GARANT_TYPES_SAISISSABLES, { message: MESSAGE_TYPE_GARANTIE_REFUSE })
  typeGarantie?: GarantTypeSaisissable;

  // Adresse du garant (voir CreateGarantDto), effaçable par `null`.
  @IsOptional()
  @IsString()
  adresse?: string | null;

  @IsOptional()
  @IsString()
  codePostal?: string | null;

  @IsOptional()
  @IsString()
  ville?: string | null;

  // Mentions manuscrites de l'acte de cautionnement (voir CreateGarantDto) —
  // modifiables après coup ici si une erreur de saisie initiale est
  // constatée, contrairement au commentaire "figées à la création" du
  // schéma garants.ts qui ne visait que l'absence de ressaisie automatique,
  // jamais une interdiction de correction manuelle.
  @IsOptional()
  @IsDateString()
  dateNaissance?: string | null;

  @IsOptional()
  @IsString()
  lieuNaissance?: string | null;

  @IsOptional()
  @IsString()
  nationalite?: string | null;

  // Locataire dont ce garant se porte caution (voir CreateGarantDto) :
  // `null` efface le lien (« non précisé »). Une nouvelle valeur doit être
  // un locataire rattaché au bail du garant ; la valeur déjà enregistrée
  // reste acceptée telle quelle, même si ce locataire a quitté le bail
  // depuis (GarantsService.update).
  @IsOptional()
  @IsUUID()
  locataireId?: string | null;

  // Numéro du contrat Visale, effaçable par null (garantie_visale seulement).
  @IsOptional()
  @IsString()
  numeroContratVisale?: string | null;
}
