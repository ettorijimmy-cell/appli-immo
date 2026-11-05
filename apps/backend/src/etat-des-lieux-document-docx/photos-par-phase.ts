export const TITRE_PHOTOS_ENTREE = "Photos à l'entrée";
export const TITRE_PHOTOS_SORTIE = "Photos à la sortie";

export interface PhotoEtatDesLieux {
  id: string;
  etatDesLieuxPieceType: string | null;
  etatDesLieuxPieceNumero: number | null;
  etatDesLieuxPhase: "entree" | "sortie" | null;
}

export interface GroupePhotos {
  titre: string;
  images: string[];
}

// Une photo sans phase date d'avant la colonne etat_des_lieux_phase : elle
// compte comme une photo d'entrée, comme pour le verrou d'archivage
// (verifierArchivagePhotoAutorise).
function phaseDe(photo: PhotoEtatDesLieux): "entree" | "sortie" {
  return photo.etatDesLieuxPhase ?? "entree";
}

// Un document d'entrée ne montre jamais une photo de sortie, même régénéré
// après la sortie. Filtré avant tout téléchargement : une photo écartée
// n'est ni déchiffrée ni journalisée.
export function photosDuDocument<T extends PhotoEtatDesLieux>(photos: T[], avecSortie: boolean): T[] {
  return photos.filter((photo) => avecSortie || phaseDe(photo) === "entree");
}

// Groupes vides omis : une pièce sans photo de sortie n'affiche pas de titre
// « Photos à la sortie » suivi de rien.
export function groupesPhotosPiece(
  photos: PhotoEtatDesLieux[],
  type: string,
  numero: number | null
): GroupePhotos[] {
  const dePiece = photos.filter((p) => p.etatDesLieuxPieceType === type && p.etatDesLieuxPieceNumero === numero);
  return [
    { titre: TITRE_PHOTOS_ENTREE, images: dePiece.filter((p) => phaseDe(p) === "entree").map((p) => p.id) },
    { titre: TITRE_PHOTOS_SORTIE, images: dePiece.filter((p) => phaseDe(p) === "sortie").map((p) => p.id) }
  ].filter((groupe) => groupe.images.length > 0);
}
