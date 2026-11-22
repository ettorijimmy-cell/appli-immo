import { MontantSaisi } from "../../common/montant-saisi.decorator";

export class AppliquerRevisionDto {
  // Strictement positif (petites suites, décision 3) : ce montant devient
  // le loyer du bail.
  @MontantSaisi("nouveau loyer", "strictement_positif")
  nouveauLoyerValide!: string;
}
