// Même règle que le verrou backend (apps/backend/src/etats-des-lieux,
// classification-colonnes-etat-des-lieux.ts + verrou-champs-etat-des-lieux.ts)
// appliquée côté affichage pour les 3 écrans à lignes en liste (Clés,
// Équipements divers, Inventaire) : une ligne EXISTANTE (id connu) a ses
// champs "entree"/communs gelés dès la signature d'entrée, quel que soit
// l'état de la sortie ; une ligne NEUVE (pas encore d'id) ne peut
// renseigner que son identité (typeCle/libelleAutre, libelle) et ses
// champs "sortie" — jamais un champ commun (ex. commentaire), même sur une
// ligne neuve (toujours refusé côté backend si fourni). Une fois la
// sortie signée, plus aucun champ n'est éditable, ligne neuve ou pas.
export type CategorieChampCommun = "identite" | "commune" | "sortie";

export function champEditable(
  categorie: CategorieChampCommun,
  ligneExistante: boolean,
  entreeSignee: boolean,
  sortieSignee: boolean
): boolean {
  if (sortieSignee) {
    return false;
  }
  if (!entreeSignee) {
    return true;
  }
  if (categorie === "sortie") {
    return true;
  }
  if (categorie === "identite") {
    return !ligneExistante;
  }
  // "commune" : jamais éditable une fois l'entrée signée, ligne neuve ou pas.
  return false;
}
