import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from "class-validator";
import { MontantSaisi } from "../../common/montant-saisi.decorator";

export const SINISTRE_TYPES = [
  "degat_eaux",
  "incendie",
  "vol",
  "bris_de_glace",
  "catastrophe_naturelle",
  "autre"
] as const;
export type SinistreType = (typeof SINISTRE_TYPES)[number];

// 'declare' est le seul statut atteignable à la création (SinistresService
// .create() ne l'accepte pas en entrée) — un sinistre naît toujours déclaré,
// voir schéma (statut par défaut).
export const SINISTRE_STATUTS = [
  "declare",
  "expertise_planifiee",
  "expertise_realisee",
  "indemnise",
  "clos"
] as const;
export type SinistreStatut = (typeof SINISTRE_STATUTS)[number];

export class CreateSinistreDto {
  @IsIn(SINISTRE_TYPES)
  type!: SinistreType;

  @IsOptional()
  @IsUUID()
  bienId?: string;

  @IsOptional()
  @IsUUID()
  appartementId?: string;

  // Contact du Carnet (rôle 'assureur' en convention, pas en contrainte
  // dure) — nullable, renseignable après la déclaration initiale. Sans
  // lui, la tâche de relance générée par la stagnation se crée quand même
  // mais sans destinataire résolu (voir SinistresService).
  @IsOptional()
  @IsUUID()
  contactAssureurId?: string;

  @IsDateString()
  dateDeclaration!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @MontantSaisi("montant réclamé", "positif_ou_nul")
  montantReclame?: string;

  // Purement informatif — jamais de lien automatique vers Charges et
  // fiscalité (décision explicite, 2026-09-16).
  @IsOptional()
  @MontantSaisi("montant indemnisé", "positif_ou_nul")
  montantIndemnise?: string;

  @IsOptional()
  @MontantSaisi("franchise", "positif_ou_nul")
  franchise?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
