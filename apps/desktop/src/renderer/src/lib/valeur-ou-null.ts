// Un champ optionnel vidé dans un formulaire de modification doit être
// envoyé comme `null` explicite pour effacer réellement la valeur en base,
// jamais en omettant la clé — sinon le champ reste inchangé côté serveur
// (voir UpdateGarantInput/UpdateLocataireInput/UpdateAppartementInput,
// docs/backlog.md). Partagé par EditGarantForm, EditLocataireForm
// (locataires/LocataireDetailView.tsx) et EditAppartementForm
// (patrimoine/AppartementDetailView.tsx) — déplacé ici (commit f3513de
// l'avait d'abord dupliqué localement) pour éviter une troisième copie.
export function valeurOuNull(valeur: string): string | null {
  return valeur === "" ? null : valeur;
}

// Variante numérique : les champs concernés (ex. appartements.nombreChambres)
// acceptent 0 comme valeur légitime, jamais confondu avec "non renseigné"
// (chaîne vide) — même logique que la vérification `!== ""` déjà en place
// dans EditAppartementForm avant ce module.
export function valeurNumeriqueOuNull(valeur: string): number | null {
  return valeur === "" ? null : Number(valeur);
}
