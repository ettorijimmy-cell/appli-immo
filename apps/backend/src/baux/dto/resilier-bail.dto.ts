import { IsDefined, Matches } from "class-validator";

// Date de fin OBLIGATOIRE depuis le chantier financier de la résiliation
// (décision 4 du 2026-11-14) : sans elle, aucun prorata du mois de fin,
// aucune clôture des échéances suivantes, et le bail restait sans date de
// fin pour toujours. Format AAAA-MM-JJ exact (la date seule, comme le champ
// date du desktop) : les calculs de packages/core refusent tout autre
// format. BauxService.resilier() revérifie (appel direct sans HTTP).
export const MESSAGE_DATE_FIN_RESILIATION_OBLIGATOIRE =
  "Indiquez la date de fin du bail (date de départ du locataire) pour le résilier.";
export const MESSAGE_DATE_FIN_RESILIATION_INVALIDE = "La date de fin doit être une date valide au format AAAA-MM-JJ.";

export class ResilierBailDto {
  @IsDefined({ message: MESSAGE_DATE_FIN_RESILIATION_OBLIGATOIRE })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: MESSAGE_DATE_FIN_RESILIATION_INVALIDE })
  dateFin!: string;
}
