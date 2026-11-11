import { IsISO8601, IsOptional, Matches } from "class-validator";

export class ArchiverBailLocataireDto {
  // Date d'effet du congé saisie au retrait du locataire (chantier garants,
  // commit 6), facultative : absente, la valeur enregistrée est conservée.
  // Une date future est acceptée (congé donné, préavis en cours).
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Date d'effet du congé invalide (AAAA-MM-JJ attendu)." })
  @IsISO8601({ strict: true }, { message: "Date d'effet du congé invalide (AAAA-MM-JJ attendu)." })
  dateEffetConge?: string;
}
