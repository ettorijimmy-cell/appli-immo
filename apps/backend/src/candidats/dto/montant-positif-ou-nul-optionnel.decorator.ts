import { applyDecorators } from "@nestjs/common";
import { IsOptional } from "class-validator";
import { MontantSaisi } from "../../common/montant-saisi.decorator";

// Montants candidat (revenu/loyer visé/revenu garant) : positifs ou nuls
// (petites suites, décision 3), même règle commune que les autres
// montants saisis (MontantSaisi), mais facultatifs — un candidat peut être
// créé sans ces informations et les compléter plus tard.
export function MontantPositifOuNulOptionnel(libelle: string) {
  return applyDecorators(IsOptional(), MontantSaisi(libelle, "positif_ou_nul"));
}
