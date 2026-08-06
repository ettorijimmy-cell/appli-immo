import { IsIn, IsOptional, IsString } from "class-validator";

export const ETATS_ELEMENT = ["M", "P", "B", "TB"] as const;
export type EtatElement = (typeof ETATS_ELEMENT)[number];

// Un élément de pièce (mur, sol, plafond...) — description libre + état
// M/P/B/TB (décret n° 2016-382, art. 2), un côté à la fois (entrée ou
// sortie selon le moment de la saisie, jamais les deux dans le même appel
// — voir docs/backlog.md, "État des lieux", parcours mobile pas-à-pas).
export class EtatElementDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(ETATS_ELEMENT)
  etatEntree?: EtatElement;

  @IsOptional()
  @IsIn(ETATS_ELEMENT)
  etatSortie?: EtatElement;
}
