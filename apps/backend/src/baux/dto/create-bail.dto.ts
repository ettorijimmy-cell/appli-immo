import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import { MontantSaisi } from "../../common/montant-saisi.decorator";

const BAIL_TYPES = ["vide", "meuble"] as const;

export class CreateBailDto {
  @IsUUID()
  appartementId!: string;

  @IsIn(BAIL_TYPES)
  typeBail!: (typeof BAIL_TYPES)[number];

  @IsDateString()
  dateDebut!: string;

  @IsOptional()
  @IsDateString()
  dateFin?: string;

  // Référence pour le régime de clause résolutoire et la mention "Fait
  // à..., le" du document généré — repli sur dateDebut si absente
  // (docs/data-dictionary.md).
  @IsOptional()
  @IsDateString()
  dateSignature?: string;

  // Si absent, pré-rempli depuis appartements.loyer_reference
  // (packages/core, preremplirLoyerBail) — voir BauxService.create.
  // Bornes (petites suites, décision 3) : loyer > 0 ; dépôt et provisions
  // >= 0 (un bail sans dépôt ou sans provisions est valable).
  @IsOptional()
  @MontantSaisi("loyer mensuel", "strictement_positif")
  loyerMensuel?: string;

  @IsOptional()
  @MontantSaisi("dépôt de garantie", "positif_ou_nul")
  depotGarantie?: string;

  @IsOptional()
  @MontantSaisi("provisions pour charges", "positif_ou_nul")
  provisionsCharges?: string;

  // Requis pour activer() (voir docs/data-dictionary.md), mais pas à la
  // création — renseignable progressivement comme loyerMensuel/depotGarantie.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  jourEcheance?: number;

  // Le bailleur a souscrit une assurance loyers impayés pour ce bail
  // (chantier garants, 2026-11-08) : une caution personne physique est
  // alors refusée à la génération, sauf locataire garanti étudiant ou
  // apprenti (packages/core, verifierGarantiesBail).
  @IsOptional()
  @IsBoolean()
  assuranceLoyersImpayes?: boolean;
}
