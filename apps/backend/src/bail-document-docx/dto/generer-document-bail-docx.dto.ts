import { IsBoolean, IsIn, IsOptional } from "class-validator";

const REGIMES_DUREE_MEUBLE = ["standard", "etudiant"] as const;

export class GenererDocumentBailDocxDto {
  // Jamais déduit : le schéma actuel n'a pas de moyen fiable de savoir
  // si un logement est soumis à une servitude de résidence principale
  // (docs/backlog.md, section "Édition d'un bail").
  @IsOptional()
  @IsBoolean()
  servitudeResidencePrincipale?: boolean;

  // Bail vide : durée dérivée automatiquement de scis.est_familiale,
  // aucun choix à faire ici. Bail meublé : rien dans le schéma ne
  // distingue "standard" de "étudiant" — choix explicite requis, "standard"
  // par défaut si omis (packages/core, regimesDureeApplicables).
  @IsOptional()
  @IsIn(REGIMES_DUREE_MEUBLE)
  regimeDureeMeuble?: (typeof REGIMES_DUREE_MEUBLE)[number];
}
