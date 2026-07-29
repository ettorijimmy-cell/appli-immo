import { navItems } from "../layout/nav-items";

export interface ActionNavigation {
  categorie: "navigation";
  id: string;
  libelle: string;
  texteRecherchable: string;
  chemin: string;
}

export interface ActionContextuelle {
  categorie: "contextuelle";
  id: "nouveau-bail" | "nouveau-paiement";
  libelle: string;
  texteRecherchable: string;
  // Ce que sélectionne l'étape 2 de recherche (appartement pour un bail,
  // bail existant pour un paiement) — voir CommandPalette.tsx.
  cibleRecherche: "appartement" | "bail";
}

export type ActionCommande = ActionNavigation | ActionContextuelle;

// Registre volontairement limité aux actions qui existent déjà dans l'app
// (docs/backlog.md, Module 8) : pas de nouvelle fonctionnalité métier. Les
// créations autonomes (Nouvelle SCI, Nouveau locataire) restent accessibles
// comme avant, sans raccourci dédié — hors périmètre du Module 8 tel que
// cadré (aucun des 5 parcours cibles de la Phase 6 ne les nécessite).
export const ACTIONS_NAVIGATION: ActionNavigation[] = navItems.map((item) => ({
  categorie: "navigation",
  id: `nav-${item.path}`,
  libelle: `Aller à ${item.label}`,
  texteRecherchable: `aller à ${item.label}`.toLowerCase(),
  chemin: item.path
}));

export const ACTIONS_CONTEXTUELLES: ActionContextuelle[] = [
  {
    categorie: "contextuelle",
    id: "nouveau-bail",
    libelle: "Nouveau bail",
    texteRecherchable: "nouveau bail",
    cibleRecherche: "appartement"
  },
  {
    categorie: "contextuelle",
    id: "nouveau-paiement",
    libelle: "Nouveau paiement",
    texteRecherchable: "nouveau paiement",
    cibleRecherche: "bail"
  }
];

export function filtrerActions(requete: string): ActionCommande[] {
  const q = requete.trim().toLowerCase();
  const toutes: ActionCommande[] = [...ACTIONS_NAVIGATION, ...ACTIONS_CONTEXTUELLES];
  if (!q) {
    return toutes;
  }
  return toutes.filter((action) => action.texteRecherchable.includes(q));
}
