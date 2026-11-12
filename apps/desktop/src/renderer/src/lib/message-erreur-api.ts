import { ApiError } from "./authenticated-fetch";

// Message par défaut que NestJS renvoie pour toute exception non typée
// (MESSAGES.UNKNOWN_EXCEPTION_MESSAGE côté backend) — jamais affiché tel
// quel : un message générique en anglais n'aide personne, et le backend
// (chantier PDF étape 4, correction du 2026-10-31) traduit désormais tout
// échec attendu (signature illisible, Gotenberg absent/en panne, refus
// métier) en message français explicite via ApiError.message — seule une
// erreur VRAIMENT inattendue retombe encore sur ce message générique.
const MESSAGE_GENERIQUE_NESTJS = "Internal server error";

// Message d'erreur à afficher après l'échec d'un appel à l'API : toujours
// celui renvoyé par le backend quand il est exploitable, jamais ce message
// générique brut — repli sur `messageParDefaut` (fourni par l'appelant,
// propre à l'action en cours) quand il ne l'est pas : erreur non-ApiError
// (réseau, etc.), message vide ou message générique NestJS.
// Né pour les cartes PDF de l'état des lieux (messageErreurCartePdf),
// partagé depuis par toutes les actions (archivage, envoi...).
export function messageErreurApi(erreur: unknown, messageParDefaut: string): string {
  if (erreur instanceof ApiError && erreur.message && erreur.message !== MESSAGE_GENERIQUE_NESTJS) {
    return erreur.message;
  }
  return messageParDefaut;
}
