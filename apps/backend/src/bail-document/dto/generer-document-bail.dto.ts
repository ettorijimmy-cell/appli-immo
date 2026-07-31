import { IsBoolean, IsIn, IsOptional, IsString } from "class-validator";

const REGIMES_DUREE = ["sci_familiale", "sci_non_familiale", "standard", "etudiant"] as const;

// Le régime applicable (vide: sci_familiale/sci_non_familiale, jamais de
// défaut ; meublé: standard/etudiant, "standard" par défaut) dépend du
// type_bail réel — validé côté service (BailDocumentService), pas ici, où
// on ne connaît pas encore le bail concerné.
export class GenererDocumentBailDto {
  @IsOptional()
  @IsIn(REGIMES_DUREE)
  regimeDuree?: (typeof REGIMES_DUREE)[number];

  @IsOptional()
  @IsString()
  conditionsParticulieres?: string;

  // Aucun champ `servitude_residence_principale` en base (schéma
  // actuel) — paramètre de génération explicite, jamais déduit
  // silencieusement, tant que cette information n'est pas modélisée
  // (docs/backlog.md, section "Édition d'un bail").
  @IsOptional()
  @IsBoolean()
  servitudeResidencePrincipale?: boolean;
}
