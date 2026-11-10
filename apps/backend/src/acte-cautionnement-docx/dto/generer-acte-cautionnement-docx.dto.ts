import { IsIn, IsOptional } from "class-validator";

const REGIMES_DUREE_MEUBLE = ["standard", "etudiant"] as const;

// Même choix que pour le bail (GenererDocumentBailDocxDto) : rien dans le
// schéma ne distingue un bail meublé standard d'un bail meublé étudiant ;
// "standard" par défaut si omis. Détermine la durée du bail et donc la date
// de fin de l'engagement de la caution.
export class GenererActeCautionnementDocxDto {
  @IsOptional()
  @IsIn(REGIMES_DUREE_MEUBLE)
  regimeDureeMeuble?: (typeof REGIMES_DUREE_MEUBLE)[number];
}
