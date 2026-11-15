import type { StatutBail } from "./cloture-financiere-resiliation";

// Libellé affiché d'un statut de bail (desktop et mobile), au lieu de la
// valeur brute de l'enum `bail_statut` — en particulier « En préavis »
// depuis que le statut `preavis` est réellement posé (vrai préavis,
// 2026-11-15).
const LIBELLES_STATUT_BAIL: Record<StatutBail, string> = {
  brouillon: "Brouillon",
  actif: "Actif",
  preavis: "En préavis",
  resilie: "Résilié",
  archive: "Archivé"
};

export function libelleStatutBail(statut: StatutBail): string {
  return LIBELLES_STATUT_BAIL[statut];
}
