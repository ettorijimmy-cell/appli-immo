import { applyDecorators } from "@nestjs/common";
import { Transform } from "class-transformer";
import { ValidateBy, type ValidationArguments } from "class-validator";
import {
  normaliserMontant,
  PLAFOND_MONTANT_SAISI_CENTIMES,
  verifierMontantSaisi,
  type RefusMontantSaisi,
  type RegleMontantSaisi
} from "core";

export type RegleMontant = "strictement_positif" | "positif_ou_nul";

// bien.valeur_acquisition est en decimal(12,2) : 9 999 999 999,99 €.
export const PLAFOND_VALEUR_ACQUISITION_CENTIMES = 999_999_999_999;

// « 99 999 999,99 € » : groupes de trois chiffres séparés par une espace,
// sans dépendre des données de locale de Node.
function formaterPlafond(plafondCentimes: number): string {
  const euros = String(Math.floor(plafondCentimes / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const centimes = String(plafondCentimes % 100).padStart(2, "0");
  return `${euros},${centimes} €`;
}

function message(libelle: string, refus: RefusMontantSaisi | "type", plafondCentimes: number): string {
  const debut = `Montant invalide pour « ${libelle} »`;
  switch (refus) {
    case "type":
    case "format":
      return `${debut} : saisissez un nombre en euros, avec deux décimales au plus (ex. 1250,50).`;
    case "negatif":
      return `${debut} : il ne peut pas être négatif.`;
    case "nul":
      return `${debut} : il doit être supérieur à 0 €.`;
    case "trop_grand":
      return `${debut} : il ne peut pas dépasser ${formaterPlafond(plafondCentimes)}.`;
  }
}

/**
 * Bornes d'un montant saisi (petites suites, décision 3 de Jimmy du
 * 2026-11-22) : normalise la saisie (virgule ou point, espaces) puis la
 * valide par la règle pure `verifierMontantSaisi` (packages/core). 400 avec
 * un message en français qui nomme le champ (`libelle`). Ne rend pas le
 * champ facultatif : `@IsOptional()` reste posé à part, là où il l'était.
 *
 * Remplace, sur chaque champ de montant des DTO, l'ancien couple
 * `@Transform(normaliserMontant)` + `@IsNumberString()` (qui acceptait 0,
 * les négatifs, « +5 » et plus de deux décimales).
 */
export function MontantSaisi(
  libelle: string,
  regle: RegleMontant,
  options: { plafondCentimes?: number } = {}
): PropertyDecorator {
  const regleCore: RegleMontantSaisi = {
    zeroAutorise: regle === "positif_ou_nul",
    ...(options.plafondCentimes !== undefined && { plafondCentimes: options.plafondCentimes })
  };
  const plafond = options.plafondCentimes ?? PLAFOND_MONTANT_SAISI_CENTIMES;

  return applyDecorators(
    Transform(({ value }: { value: unknown }) => (typeof value === "string" ? normaliserMontant(value) : value)),
    ValidateBy({
      name: "montantSaisi",
      validator: {
        validate: (valeur: unknown) => typeof valeur === "string" && verifierMontantSaisi(valeur, regleCore) === null,
        defaultMessage: (args?: ValidationArguments) => {
          const valeur: unknown = args?.value;
          const refus = typeof valeur === "string" ? (verifierMontantSaisi(valeur, regleCore) ?? "format") : "type";
          return message(libelle, refus, plafond);
        }
      }
    })
  );
}
