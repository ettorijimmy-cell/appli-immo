import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, Matches } from "class-validator";
import { normaliserMontant } from "core";

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
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "montantReclame doit être un nombre positif" })
  montantReclame?: string;

  // Purement informatif — jamais de lien automatique vers Charges et
  // fiscalité (décision explicite, 2026-09-16).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "montantIndemnise doit être un nombre positif" })
  montantIndemnise?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? normaliserMontant(value) : value))
  @IsNumberString()
  @Matches(/^\d+(\.\d+)?$/, { message: "franchise doit être un nombre positif" })
  franchise?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
