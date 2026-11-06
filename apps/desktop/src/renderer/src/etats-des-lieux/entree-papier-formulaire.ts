import { contenuEstUnPdf, refusDateEntreePapier, TAILLE_MAX_SCAN_ENTREE_PAPIER_OCTETS } from "core";
import type { DocumentMetier } from "../documents/api";

// Règles d'affichage du formulaire « Reprise d'une entrée signée sur papier »
// (desktop, 2026-11-06). Le backend refait tous ces contrôles : ici, il
// s'agit seulement de prévenir avant l'envoi, avec les mêmes messages.

const LIBELLE_PIECE: Record<string, string> = {
  entree: "Entrée",
  sejour: "Séjour",
  cuisine: "Cuisine",
  chambre: "Chambre",
  salle_de_bain: "Salle de bain",
  wc: "WC",
  autre: "Autre pièce"
};

// Photos d'entrée encore actives (phase entrée ou sans phase), par pièce :
// la déclaration papier est refusée tant qu'il en reste (décision 10).
export function piecesAvecPhotosEntree(photos: DocumentMetier[]): string[] {
  const pieces = photos
    .filter((p) => p.archivedAt === null && (p.etatDesLieuxPhase ?? null) !== "sortie")
    .map((p) => {
      const libelle = p.etatDesLieuxPieceType ? (LIBELLE_PIECE[p.etatDesLieuxPieceType] ?? p.etatDesLieuxPieceType) : "Sans pièce";
      return p.etatDesLieuxPieceNumero !== null ? `${libelle} ${p.etatDesLieuxPieceNumero}` : libelle;
    });
  return [...new Set(pieces)].sort((a, b) => a.localeCompare(b, "fr"));
}

export interface SaisieEntreePapier {
  dateSignature: string;
  lieu: string;
  bailleurNom: string;
  locataireIds: string[];
  scan: { nom: string; taille: number } | null;
  fideliteConfirmee: boolean;
}

// Erreurs bloquantes de saisie, dans l'ordre du formulaire. Le scan n'est
// exigé qu'à la première déclaration.
export function erreursSaisieEntreePapier(
  saisie: SaisieEntreePapier,
  mode: "declaration" | "correction",
  aujourdHui: string
): string[] {
  const erreurs: string[] = [];
  const refusDate = saisie.dateSignature ? refusDateEntreePapier(saisie.dateSignature, aujourdHui) : "La date est obligatoire.";
  if (refusDate) {
    erreurs.push(refusDate);
  }
  if (!saisie.lieu.trim()) {
    erreurs.push("Le lieu est obligatoire.");
  }
  if (!saisie.bailleurNom.trim()) {
    erreurs.push("Le nom du bailleur est obligatoire.");
  }
  if (saisie.locataireIds.length === 0) {
    erreurs.push("Cochez au moins un locataire signataire.");
  }
  if (mode === "declaration" && !saisie.scan) {
    erreurs.push("Le scan PDF de l'état des lieux signé est obligatoire.");
  }
  if (saisie.scan && saisie.scan.taille > TAILLE_MAX_SCAN_ENTREE_PAPIER_OCTETS) {
    erreurs.push(`Le scan dépasse ${TAILLE_MAX_SCAN_ENTREE_PAPIER_OCTETS / (1024 * 1024)} Mo.`);
  }
  if (!saisie.fideliteConfirmee) {
    erreurs.push("Confirmez que les états saisis reproduisent fidèlement l'original.");
  }
  return erreurs;
}

// Le contenu du fichier choisi, lu avant l'envoi : un fichier qui n'est pas
// un PDF est signalé tout de suite plutôt qu'au retour du serveur.
export async function fichierEstUnPdf(fichier: Blob): Promise<boolean> {
  const debut = new Uint8Array(await fichier.slice(0, 8).arrayBuffer());
  return contenuEstUnPdf(debut);
}
