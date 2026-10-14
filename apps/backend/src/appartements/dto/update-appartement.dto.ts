import {
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf
} from "class-validator";

const APPARTEMENT_TYPES = ["T1", "T2", "T3", "T4", "T5", "T6"] as const;
const MODES_PRODUCTION = ["individuel", "collectif"] as const;
const TYPES_ENERGIE = ["electrique", "gaz", "les_deux"] as const;
const CLASSES_DPE = ["A", "B", "C", "D", "E", "F", "G"] as const;
// "archive" en est exclu : l'archivage passe exclusivement par l'endpoint
// dédié /appartements/:id/archiver, qui pose aussi archivedAt — un statut
// "archive" posé ici casserait l'invariant archive <=> archivedAt renseigné.
const APPARTEMENT_STATUTS_MODIFIABLES = ["vacant", "loue", "travaux"] as const;

export class UpdateAppartementDto {
  // @ValidateIf (pas @IsOptional) : numero ne doit jamais pouvoir passer à
  // null (point 6c, docs/backlog.md) — contrairement à @IsOptional(),
  // qui traite `null` comme "absent" et sauterait @IsString/@MinLength,
  // laissant passer un `numero: null` explicite malgré son typage TS
  // `string?` sans `| null`. @ValidateIf ne sautent la validation que
  // lorsque la clé est réellement absente (`undefined`), jamais sur un
  // `null` explicite, qui est alors rejeté par @IsString().
  @ValidateIf((o) => o.numero !== undefined)
  @IsString()
  @MinLength(1)
  numero?: string;

  // `| null` : accepté syntaxiquement ici, mais AppartementsService.update()
  // rejette explicitement un `null` sur ce champ pour un bien résidentiel
  // (voir CHAMPS_HABITATION_REQUIS_A_LA_CREATION) — la dépendance au type du
  // bien parent ne peut pas s'exprimer au niveau du DTO.
  @IsOptional()
  @IsIn(APPARTEMENT_TYPES)
  type?: (typeof APPARTEMENT_TYPES)[number] | null;

  // `| null` : revu par financial-logic-reviewer avant commit (point 6c,
  // docs/backlog.md) — surface/tantieme/loyerReference alimentent la
  // répartition des charges communes (repartirProportionnellement,
  // packages/core) et la régularisation des charges.
  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "surface doit être un nombre positif" })
  surface?: string | null;

  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "tantieme doit être un nombre positif" })
  tantieme?: string | null;

  @IsOptional()
  @IsNumberString()
  loyerReference?: string | null;

  @IsOptional()
  @IsString()
  equipementCuisine?: string | null;

  @IsOptional()
  @IsString()
  dependancesAnnexes?: string | null;

  // `| null` : accepté syntaxiquement ici, mais AppartementsService.update()
  // rejette explicitement un `null` sur ces 3 champs pour un bien
  // résidentiel — voir le commentaire sur `type` ci-dessus.
  @IsOptional()
  @IsInt()
  @Min(1)
  nombrePiecesPrincipales?: number | null;

  @IsOptional()
  @IsIn(MODES_PRODUCTION)
  modeChauffage?: (typeof MODES_PRODUCTION)[number] | null;

  @IsOptional()
  @IsIn(MODES_PRODUCTION)
  modeEauChaude?: (typeof MODES_PRODUCTION)[number] | null;

  @IsOptional()
  @IsIn(TYPES_ENERGIE)
  typeEnergie?: (typeof TYPES_ENERGIE)[number] | null;

  // Composition réelle du logement (module État des lieux) — 0 est une
  // valeur légitime (ex. studio sans chambre séparée), distincte de
  // `null` (non renseigné/à effacer).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  nombreChambres?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  nombreSallesDeBain?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  nombreWc?: number | null;

  // Libellés fixes des 2 emplacements libres du modèle réel — jamais
  // saisis à la volée depuis l'état des lieux (voir
  // packages/db/src/schema/appartements.ts).
  @IsOptional()
  @IsString()
  autrePiece1?: string | null;

  @IsOptional()
  @IsString()
  autrePiece2?: string | null;

  // Mentions de performance énergétique (contrat-type, décret n°
  // 2015-587) — voir CreateAppartementDto.
  @IsOptional()
  @IsIn(CLASSES_DPE)
  classeDpe?: (typeof CLASSES_DPE)[number] | null;

  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "depensesEnergieMin doit être un nombre positif" })
  depensesEnergieMin?: string | null;

  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "depensesEnergieMax doit être un nombre positif" })
  depensesEnergieMax?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  anneeReferencePrixEnergie?: number | null;

  // Passage manuel vacant / loue / travaux — l'automatisation vacant <-> loue
  // via la création/résiliation de bail arrive au Module 3 ; le réglage
  // manuel restera disponible pour correction de saisie, sauf décision
  // contraire à ce moment-là (voir docs/backlog.md, Module 3). Jamais
  // `null` : un appartement a toujours un statut concret.
  @IsOptional()
  @IsIn(APPARTEMENT_STATUTS_MODIFIABLES)
  statut?: (typeof APPARTEMENT_STATUTS_MODIFIABLES)[number];
}
