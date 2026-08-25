import { calculerStatutDocument } from "./calculer-statut-document";

export interface DocumentPourCompletude {
  id: string;
  categorie: string;
  nomFichier: string;
  dateExpiration: string | null;
  archive: boolean;
  createdAt: string;
}

export interface CompletudeCategorie {
  categorie: string;
  document: { id: string; nomFichier: string } | null;
}

/**
 * Réutilisée à la fois par la checklist documentaire agrégée (Tableau de
 * bord, TableauDeBordService.getChecklistDocumentaire — ne garde que les
 * catégories manquantes) et par la vue détaillée par entité (statut complet,
 * y compris les catégories déjà satisfaites) — une seule source de vérité
 * pour "qu'est-ce qui compte comme un document valide pour cette
 * catégorie" (docs/backlog.md, checklist documentaire).
 *
 * Un document expiré compte comme MANQUANT ici (contrairement à sa présence
 * en annexe d'un bail déjà signé, qui ne regarde que l'archivage) — deux
 * besoins différents, pas une incohérence.
 *
 * Si plusieurs documents valides existent pour la même catégorie (rare —
 * une nouvelle version devrait normalement archiver l'ancienne), le plus
 * récemment créé est retenu : l'appelant doit fournir `documents` déjà
 * triés par `createdAt` décroissant pour un résultat déterministe.
 */
export function evaluerCompletudeCategories(
  documents: DocumentPourCompletude[],
  categoriesAttendues: string[],
  dateReference: string
): CompletudeCategorie[] {
  return categoriesAttendues.map((categorie) => {
    const document = documents.find(
      (d) => d.categorie === categorie && calculerStatutDocument(d.dateExpiration, d.archive, dateReference) === "valide"
    );
    return {
      categorie,
      document: document ? { id: document.id, nomFichier: document.nomFichier } : null
    };
  });
}
