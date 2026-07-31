import type { ChoixDureeBail, TrancheConstruction } from "core";

// Entrées "à plat" par section : chaque fonction de section
// (sections/section-*.ts) est pure — aucun accès DB, testable
// unitairement sur son seul contenu/structure (BailDocumentService est seul
// responsable d'aller chercher ces données et de les assembler).

export interface BailleurDocument {
  nom: string;
  adresse: string;
  codePostal: string | null;
  ville: string | null;
  nomGerant: string | null;
  prenomGerant: string | null;
}

export interface LocataireDocument {
  nom: string;
  prenom: string;
  email: string | null;
}

export interface LogementDocument {
  adresseImmeuble: string;
  codePostalImmeuble: string | null;
  villeImmeuble: string | null;
  numeroLot: string;
  identifiantFiscal: string | null;
  typeHabitat: "collectif" | "individuel" | null;
  regimeJuridique: "mono_propriete" | "copropriete" | null;
  trancheConstruction: TrancheConstruction | null;
  surface: string | null;
  nombrePiecesPrincipales: number | null;
  modeChauffage: "individuel" | "collectif" | null;
  modeEauChaude: "individuel" | "collectif" | null;
  classeDpe: "A" | "B" | "C" | "D" | "E" | "F" | "G" | null;
  depensesTheoriquesChauffage: string | null;
}

export interface DiagnosticAnnexe {
  categorie: "dpe" | "crep_plomb" | "erp" | "elec_gaz";
  present: boolean;
  dateExpiration: string | null;
}

export interface DonneesSectionI {
  bailleur: BailleurDocument;
  locataires: LocataireDocument[];
}

export interface DonneesSectionII {
  typeBail: "vide" | "meuble";
  logement: LogementDocument;
  // Mention "Servitude de résidence principale" (décret n° 2026-596 du 6
  // juillet 2026, applicable aux baux conclus/renouvelés à compter du 1er
  // octobre 2026 — voir section VIII) : n'apparaît dans le contrat-type
  // qu'à partir de cette date, jamais avant, même si applicable.
  dateReference: string;
  servitudeResidencePrincipale: boolean;
}

export interface DonneesSectionIII {
  dateDebut: string;
  choixDuree: ChoixDureeBail;
}

export interface DonneesSectionIV {
  loyerMensuel: string | null;
  provisionsCharges: string | null;
  loyerPrecedentLocataire: string | null;
  depensesTheoriquesChauffage: string | null;
}

export interface DonneesSectionV {
  travauxRealises: string | null;
}

export interface DonneesSectionVI {
  depotGarantie: string | null;
}

export interface DonneesSectionVII {
  nombreLocataires: number;
}

export interface DonneesSectionVIII {
  dateReference: string;
  servitudeResidencePrincipale: boolean;
}

export interface DonneesSectionIX {
  honorairesBailleur: string | null;
  honorairesLocataire: string | null;
}

export interface DonneesSectionX {
  conditionsParticulieres: string | null;
}

export interface DonneesSectionXI {
  typeBail: "vide" | "meuble";
  diagnostics: DiagnosticAnnexe[];
  attestationAssurancePresente: boolean;
  etatDesLieuxEntreePresent: boolean;
}
