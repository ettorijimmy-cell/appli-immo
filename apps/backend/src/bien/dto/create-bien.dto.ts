import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength
} from "class-validator";

const BIEN_TYPES = [
  "immeuble",
  "maison",
  "appartement_isole",
  "parking",
  "bureau",
  "local_commercial"
] as const;
const PROPRIETAIRE_TYPES = ["sci", "personne_physique"] as const;
const TYPES_HABITAT = ["collectif", "individuel"] as const;
const REGIMES_JURIDIQUES = ["mono_propriete", "copropriete"] as const;

export class CreateBienDto {
  @IsIn(BIEN_TYPES)
  type!: (typeof BIEN_TYPES)[number];

  @IsIn(PROPRIETAIRE_TYPES)
  proprietaireType!: (typeof PROPRIETAIRE_TYPES)[number];

  // Cohérence avec proprietaireType (requis si 'sci', doit être absent si
  // 'personne_physique') vérifiée dans BienService.create, pas ici — même
  // contrainte que bien_sci_id_coherent en base, message d'erreur clair
  // avant d'atteindre la contrainte SQL.
  @IsOptional()
  @IsUUID()
  sciId?: string;

  @IsString()
  @MinLength(1)
  adresse!: string;

  @IsString()
  @MinLength(1)
  codePostal!: string;

  @IsString()
  @MinLength(1)
  ville!: string;

  // Requis uniquement si type='immeuble' (vérifié dans BienService.create —
  // même contrainte que bien_nom_requis_si_immeuble en base). Repli
  // d'affichage bien.nom ?? bien.adresse partout ailleurs dans l'app.
  @IsOptional()
  @IsString()
  @MinLength(1)
  nom?: string;

  @IsOptional()
  @IsInt()
  @Min(1800)
  @Max(2100)
  anneeConstruction?: number;

  @IsOptional()
  @IsDateString()
  dateAcquisition?: string;

  @IsOptional()
  @IsNumberString()
  valeurAcquisition?: string;

  // bien_immeuble_detail — typeHabitat/regimeJuridique requis uniquement si
  // type='immeuble' (vérifié dans BienService.create, même mentions
  // contrat-type que CreateImmeubleDto historiquement). syndic/nbLots/
  // chargesCoproAnnuelles restent facultatifs (pas de mention contrat-type
  // associée).
  @IsOptional()
  @IsIn(TYPES_HABITAT)
  typeHabitat?: (typeof TYPES_HABITAT)[number];

  @IsOptional()
  @IsIn(REGIMES_JURIDIQUES)
  regimeJuridique?: (typeof REGIMES_JURIDIQUES)[number];

  @IsOptional()
  @IsString()
  syndic?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  nbLots?: number;

  @IsOptional()
  @IsNumberString()
  chargesCoproAnnuelles?: string;
}
