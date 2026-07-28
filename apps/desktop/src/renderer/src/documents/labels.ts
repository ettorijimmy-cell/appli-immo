import type { DocumentCategorie, DocumentEntiteType, DocumentStatut } from "./api";

export const CATEGORIE_LABELS: Record<DocumentCategorie, string> = {
  bail: "Bail",
  assurance: "Assurance",
  etat_des_lieux: "État des lieux",
  diagnostic: "Diagnostic",
  dpe: "DPE",
  piece_identite: "Pièce d'identité",
  rib: "RIB",
  caf: "CAF",
  quittance: "Quittance",
  courrier: "Courrier",
  photo: "Photo"
};

export const ENTITE_TYPE_LABELS: Record<DocumentEntiteType, string> = {
  sci: "SCI",
  immeuble: "Immeuble",
  appartement: "Appartement",
  locataire: "Locataire",
  bail: "Bail"
};

export const STATUT_LABELS: Record<DocumentStatut, string> = {
  valide: "Valide",
  expire: "Expiré",
  archive: "Archivé"
};

export const STATUT_BADGE_CLASSNAMES: Record<DocumentStatut, string> = {
  valide: "bg-emerald-100 text-emerald-700",
  expire: "bg-red-100 text-red-700",
  archive: "bg-slate-200 text-slate-600"
};
