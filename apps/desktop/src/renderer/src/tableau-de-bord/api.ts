import { authenticatedFetch } from "../lib/authenticated-fetch";

export interface EnTete {
  biensLoues: number;
  biensVacants: number;
  biensTravaux: number;
  valeurLocativeTotale: string;
}

export interface Cartes {
  impayes: { nombre: number; montantRestant: string };
  echeancesAVenir: number;
  documentsExpires: number;
  alertesActives: number;
}

export interface RevenuMensuel {
  mois: string;
  loyerNet: string;
  provisions: string;
}

export interface RevenusLocatifs {
  periodeDebut: string;
  periodeFin: string;
  parMois: RevenuMensuel[];
  totalLoyerNet: string;
  totalProvisions: string;
}

export interface SyntheseAppartement {
  id: string;
  numero: string;
  revenuNet: string;
  tauxOccupation: number;
  archive: boolean;
}

export interface SyntheseImmeuble {
  id: string;
  nom: string;
  revenuNet: string;
  tauxOccupation: number;
  archive: boolean;
  appartements: SyntheseAppartement[];
}

export interface SyntheseSci {
  id: string;
  nom: string;
  revenuNet: string;
  tauxOccupation: number;
  archive: boolean;
  immeubles: SyntheseImmeuble[];
}

export function getEnTete(): Promise<EnTete> {
  return authenticatedFetch<EnTete>("/tableau-de-bord/en-tete");
}

export function getCartes(): Promise<Cartes> {
  return authenticatedFetch<Cartes>("/tableau-de-bord/cartes");
}

export function getRevenusLocatifs(debut: string, fin: string): Promise<RevenusLocatifs> {
  return authenticatedFetch<RevenusLocatifs>(
    `/tableau-de-bord/revenus-locatifs?debut=${debut}&fin=${fin}`
  );
}

export function getSynthese(debut: string, fin: string): Promise<SyntheseSci[]> {
  return authenticatedFetch<SyntheseSci[]>(`/tableau-de-bord/synthese?debut=${debut}&fin=${fin}`);
}

export function getDerniereSauvegarde(): Promise<{ dateIso: string | null }> {
  return authenticatedFetch<{ dateIso: string | null }>("/tableau-de-bord/derniere-sauvegarde");
}
