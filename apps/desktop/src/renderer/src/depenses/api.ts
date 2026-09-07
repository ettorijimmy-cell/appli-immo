import { authenticatedFetch } from "../lib/authenticated-fetch";

// 7 catégories du Plan Comptable Général alimentant le tableau VII du
// formulaire 2072 (voir packages/db/src/schema/depense.ts, apps/backend/
// src/depenses/dto/create-depense.dto.ts) — pas une nomenclature arbitraire.
export type DepenseCategorie =
  | "frais_gestion"
  | "assurance"
  | "reparation_entretien"
  | "impots_taxes"
  | "charges_copropriete"
  | "interets_emprunt"
  | "autre";

export const DEPENSE_CATEGORIES: DepenseCategorie[] = [
  "frais_gestion",
  "assurance",
  "reparation_entretien",
  "impots_taxes",
  "charges_copropriete",
  "interets_emprunt",
  "autre"
];

export const DEPENSE_CATEGORIE_LABELS: Record<DepenseCategorie, string> = {
  frais_gestion: "Frais de gestion",
  assurance: "Assurance",
  reparation_entretien: "Réparation / entretien",
  impots_taxes: "Impôts et taxes",
  charges_copropriete: "Charges de copropriété",
  interets_emprunt: "Intérêts d'emprunt",
  autre: "Autre"
};

export interface Depense {
  id: string;
  categorie: DepenseCategorie;
  montant: string;
  dateDepense: string;
  libelle: string;
  bienId: string | null;
  sciId: string | null;
  organisationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDepenseInput {
  categorie: DepenseCategorie;
  montant: string;
  dateDepense: string;
  libelle: string;
  bienId?: string;
  sciId?: string;
}

export interface FindAllDepensesFiltres {
  categorie?: DepenseCategorie;
  bienId?: string;
  sciId?: string;
  dateDebut?: string;
  dateFin?: string;
}

export interface LigneReleveCsvDepense {
  id: string;
  date: string;
  montant: string;
  libelle: string;
}

export function listDepenses(filtres: FindAllDepensesFiltres = {}): Promise<Depense[]> {
  const params = new URLSearchParams();
  if (filtres.categorie) params.set("categorie", filtres.categorie);
  if (filtres.bienId) params.set("bienId", filtres.bienId);
  if (filtres.sciId) params.set("sciId", filtres.sciId);
  if (filtres.dateDebut) params.set("dateDebut", filtres.dateDebut);
  if (filtres.dateFin) params.set("dateFin", filtres.dateFin);
  const query = params.toString();
  return authenticatedFetch<Depense[]>(`/depenses${query ? `?${query}` : ""}`);
}

export function createDepense(input: CreateDepenseInput): Promise<Depense> {
  return authenticatedFetch<Depense>("/depenses", { method: "POST", body: JSON.stringify(input) });
}

// Analyse pure côté backend (aucune écriture) — voir DepensesService
// .parserCsv. Chaque ligne renvoyée reste à confirmer manuellement (choix
// d'une catégorie + rattachement bien/SCI) avant de devenir une dépense
// réelle via createDepense.
export function parserCsvDepenses(contenuCsv: string): Promise<LigneReleveCsvDepense[]> {
  return authenticatedFetch<LigneReleveCsvDepense[]>("/depenses/parser-csv", {
    method: "POST",
    body: JSON.stringify({ contenuCsv })
  });
}
