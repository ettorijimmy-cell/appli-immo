import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class CreateSciDto {
  @IsString()
  @MinLength(1)
  nom!: string;

  @IsIn(["IS", "IR"])
  regimeFiscal!: "IS" | "IR";

  @IsOptional()
  @IsString()
  formeJuridique?: string;

  @IsOptional()
  @IsString()
  siret?: string;

  // Siège social — connu dès la création d'une SCI, contrairement à
  // telephone/estFamiliale ci-dessous, restés facultatifs puisqu'une
  // coordonnée ou un choix peuvent être renseignés plus tard sans bloquer
  // la création. Obligatoire uniquement à la création : le schéma reste
  // nullable, les SCI déjà créées avant ce durcissement ne sont jamais
  // forcées rétroactivement (docs/data-dictionary.md).
  @IsString()
  @MinLength(1)
  adresse!: string;

  @IsString()
  @MinLength(1)
  codePostal!: string;

  @IsString()
  @MinLength(1)
  ville!: string;

  // Point 6d (docs/backlog.md) : proposés dès la création (optionnels),
  // contrairement à avant où ils n'étaient saisissables qu'en modification.
  @IsOptional()
  @IsString()
  telephone?: string;

  // Pas de valeur par défaut, y compris ici : absent à la création doit
  // rester NULL en base, jamais false (docs/data-dictionary.md).
  @IsOptional()
  @IsBoolean()
  estFamiliale?: boolean;

  // Représentant légal de la SCI (chantier bail — corrections juridiques,
  // commit C) : optionnels, comme telephone ci-dessus — une SCI peut être
  // créée sans connaître encore son gérant. Absent du modèle de bail tant
  // que non renseigné (mécanisme [À COMPLÉTER], jamais de blocage de
  // génération — voir bail-document-docx.service.ts).
  @IsOptional()
  @IsString()
  nomGerant?: string;

  @IsOptional()
  @IsString()
  prenomGerant?: string;
}
