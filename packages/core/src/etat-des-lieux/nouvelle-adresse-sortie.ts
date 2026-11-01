// Décret n° 2016-382, art. 2, 2° a) : à la sortie, l'état des lieux comporte
// l'adresse du nouveau domicile ou du lieu d'hébergement du locataire.
// Texte libre, décision assumée : une seule valeur pour tous les
// colocataires, le nom devant chaque adresse, et une mention comme
// « Non communiquée par le locataire » est acceptée.
export const LONGUEUR_MAX_NOUVELLE_ADRESSE = 500;

// La saisie l'emporte sur la valeur déjà enregistrée dès qu'elle est
// fournie, même vide : effacer le champ à l'écran ne doit jamais faire
// signer silencieusement l'ancienne adresse. null si aucune adresse
// exploitable, c'est-à-dire si la sortie ne peut pas être signée.
export function resoudreNouvelleAdresseSortie(
  saisie: string | null | undefined,
  enregistree: string | null | undefined
): string | null {
  const adresse = (saisie ?? enregistree ?? "").trim();
  return adresse === "" ? null : adresse;
}
