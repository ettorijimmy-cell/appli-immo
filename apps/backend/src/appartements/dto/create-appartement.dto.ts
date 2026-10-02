import { IsIn, IsInt, IsNumberString, IsOptional, IsString, IsUUID, Matches, Min, MinLength } from "class-validator";

const APPARTEMENT_TYPES = ["T1", "T2", "T3", "T4", "T5", "T6"] as const;
const MODES_PRODUCTION = ["individuel", "collectif"] as const;
const TYPES_ENERGIE = ["electrique", "gaz", "les_deux"] as const;

export class CreateAppartementDto {
  @IsUUID()
  bienId!: string;

  @IsString()
  @MinLength(1)
  numero!: string;

  // type/nombrePiecesPrincipales/modeChauffage/modeEauChaude/typeEnergie :
  // mentions du contrat-type résidentiel (décret n° 2015-587), sans objet
  // pour un bien non résidentiel (parking/bureau/local_commercial — voir
  // packages/core, estTypeResidentiel). Optionnels ici au niveau de la
  // forme : le caractère obligatoire (bien résidentiel) ou interdit (bien
  // non résidentiel) dépend du type du bien parent, résolu et vérifié dans
  // AppartementsService.create() — audit du 2026-08-27, docs/backlog.md.
  @IsOptional()
  @IsIn(APPARTEMENT_TYPES)
  type?: (typeof APPARTEMENT_TYPES)[number];

  // @Matches rejette explicitement un signe négatif — même garde-fou que
  // CreateDepenseDto.montant (revue financial-logic-reviewer, 2026-10-02) :
  // utilisée comme poids de répartition proportionnelle (Sous-commit D,
  // DepensesService.repartirDepenseEntreLots), une valeur négative
  // fausserait silencieusement le calcul des parts de tous les lots.
  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "surface doit être un nombre positif" })
  surface?: string;

  // Module Régularisation des charges, Sous-commit B — clé de répartition
  // des charges communes, surface en repli si absent. Pure saisie à ce
  // stade, aucun calcul de répartition (voir packages/db/src/schema/
  // appartements.ts). Même garde-fou de signe que surface ci-dessus.
  @IsOptional()
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "tantieme doit être un nombre positif" })
  tantieme?: string;

  @IsOptional()
  @IsNumberString()
  loyerReference?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  nombrePiecesPrincipales?: number;

  @IsOptional()
  @IsIn(MODES_PRODUCTION)
  modeChauffage?: (typeof MODES_PRODUCTION)[number];

  @IsOptional()
  @IsIn(MODES_PRODUCTION)
  modeEauChaude?: (typeof MODES_PRODUCTION)[number];

  @IsOptional()
  @IsIn(TYPES_ENERGIE)
  typeEnergie?: (typeof TYPES_ENERGIE)[number];
}
