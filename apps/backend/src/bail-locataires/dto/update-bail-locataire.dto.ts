import { IsISO8601, Matches, ValidateIf } from "class-validator";

export class UpdateBailLocataireDto {
  // Date d'effet du congé donné par ce locataire (chantier garants, commit
  // 6) : AAAA-MM-JJ, ou null pour l'effacer. Clé obligatoire : seul champ
  // modifiable d'un lien au bail.
  @ValidateIf((o: UpdateBailLocataireDto) => o.dateEffetConge !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Date d'effet du congé invalide (AAAA-MM-JJ attendu)." })
  @IsISO8601({ strict: true }, { message: "Date d'effet du congé invalide (AAAA-MM-JJ attendu)." })
  dateEffetConge!: string | null;
}
