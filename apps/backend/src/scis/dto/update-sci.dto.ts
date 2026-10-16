import { IsBoolean, IsIn, IsOptional, IsString, MinLength, ValidateIf } from "class-validator";

export class UpdateSciDto {
  // @ValidateIf (pas @IsOptional) : nom/regimeFiscal ne doivent jamais
  // pouvoir passer à null — colonnes NOT NULL en base
  // (packages/db/src/schema/scis.ts). @IsOptional() traite `null` comme
  // "absent" et sauterait @IsString/@MinLength ou @IsIn, laissant passer un
  // `null` explicite malgré leur typage TS sans `| null` — même correctif
  // que numero sur UpdateAppartementDto (point 6c) et nom/prenom sur
  // UpdateLocataireDto/UpdateGarantDto (commit 99169d2).
  @ValidateIf((o) => o.nom !== undefined)
  @IsString()
  @MinLength(1)
  nom?: string;

  @ValidateIf((o) => o.regimeFiscal !== undefined)
  @IsIn(["IS", "IR"])
  regimeFiscal?: "IS" | "IR";

  @IsOptional()
  @IsString()
  formeJuridique?: string;

  @IsOptional()
  @IsString()
  siret?: string;

  // Facultatifs ici (contrairement à CreateSciDto) : une SCI créée avant
  // que ces champs deviennent obligatoires à la création doit rester
  // modifiable normalement, sans être forcée à tout ressaisir d'un coup
  // (docs/data-dictionary.md).
  @IsOptional()
  @IsString()
  @MinLength(1)
  adresse?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  codePostal?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  ville?: string;

  // `| null` (point 6d, docs/backlog.md) : un champ vidé dans EditSciForm
  // doit être envoyé comme `null` explicite pour effacer réellement la
  // valeur en base — omettre la clé laisserait l'ancienne valeur
  // inchangée.
  @IsOptional()
  @IsString()
  telephone?: string | null;

  // `| null` (point 6d) : "Non renseigné" dans EditSciForm doit pouvoir
  // revenir à null, distinct de `false` — pas de valeur par défaut, y
  // compris ici.
  @IsOptional()
  @IsBoolean()
  estFamiliale?: boolean | null;

  // Représentant légal de la SCI (chantier bail — corrections juridiques,
  // commit C) : `| null` comme telephone/estFamiliale ci-dessus, pour
  // pouvoir réellement effacer un gérant déjà renseigné.
  @IsOptional()
  @IsString()
  nomGerant?: string | null;

  @IsOptional()
  @IsString()
  prenomGerant?: string | null;
}
