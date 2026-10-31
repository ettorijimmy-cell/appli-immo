import { ApiError } from "../lib/authenticated-fetch";

// Message par défaut que NestJS renvoie pour toute exception non typée
// (MESSAGES.UNKNOWN_EXCEPTION_MESSAGE côté backend) — jamais affiché tel
// quel : un message générique en anglais n'aide personne, et le backend
// (chantier PDF étape 4, correction du 2026-10-31) traduit désormais tout
// échec attendu (signature illisible, Gotenberg absent/en panne) en
// message français explicite via ApiError.message — seule une erreur
// VRAIMENT inattendue retombe encore sur ce message générique.
const MESSAGE_GENERIQUE_NESTJS = "Internal server error";

// DocumentsFigesCard (lecture du statut, production manuelle) : affiche
// toujours le message renvoyé par le backend quand il est exploitable,
// jamais ce message générique brut — repli sur `messageParDefaut` (fourni
// par l'appelant, propre à l'action en cours) dans les deux cas où il ne
// l'est pas : erreur non-ApiError (réseau, etc.) ou message générique
// NestJS.
export function messageErreurCartePdf(erreur: unknown, messageParDefaut: string): string {
  if (erreur instanceof ApiError && erreur.message && erreur.message !== MESSAGE_GENERIQUE_NESTJS) {
    return erreur.message;
  }
  return messageParDefaut;
}
