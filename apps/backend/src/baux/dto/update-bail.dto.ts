import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { MontantSaisi } from "../../common/montant-saisi.decorator";

const BAIL_TYPES = ["vide", "meuble"] as const;

// Volontairement AUCUN champ `statut` ici : les transitions de statut d'un
// bail passent exclusivement par les endpoints dédiés (activer / résilier /
// archiver, voir BauxController), qui déclenchent aussi la transition
// automatique du statut de l'appartement. Un update() générique ne doit
// jamais pouvoir contourner cette règle par inadvertance.
export class UpdateBailDto {
  @IsOptional()
  @IsIn(BAIL_TYPES)
  typeBail?: (typeof BAIL_TYPES)[number];

  @IsOptional()
  @IsDateString()
  dateDebut?: string;

  @IsOptional()
  @IsDateString()
  dateFin?: string;

  @IsOptional()
  @IsDateString()
  dateSignature?: string;

  // Mêmes bornes qu'à la création (petites suites, décision 3).
  @IsOptional()
  @MontantSaisi("loyer mensuel", "strictement_positif")
  loyerMensuel?: string;

  @IsOptional()
  @MontantSaisi("dépôt de garantie", "positif_ou_nul")
  depotGarantie?: string;

  @IsOptional()
  @MontantSaisi("provisions pour charges", "positif_ou_nul")
  provisionsCharges?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  jourEcheance?: number;

  @IsOptional()
  @IsString()
  travauxRealises?: string;

  @IsOptional()
  @MontantSaisi("honoraires à la charge du bailleur", "positif_ou_nul")
  honorairesBailleur?: string;

  @IsOptional()
  @MontantSaisi("honoraires à la charge du locataire", "positif_ou_nul")
  honorairesLocataire?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  trimestreReferenceRevision?: number;

  // Le bailleur a souscrit une assurance loyers impayés pour ce bail
  // (chantier garants, 2026-11-08) : une caution personne physique est
  // alors refusée à la génération, sauf locataire garanti étudiant ou
  // apprenti (packages/core, verifierGarantiesBail).
  @IsOptional()
  @IsBoolean()
  assuranceLoyersImpayes?: boolean;
}
