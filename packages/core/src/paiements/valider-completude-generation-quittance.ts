/**
 * Vérifie que les données nécessaires à la génération du document de
 * quittance sont bien renseignées, AVANT de générer quoi que ce soit —
 * même discipline que validerCompletudeGenerationBail (packages/core/src/
 * baux/valider-completude-generation-bail.ts) : jamais un champ absent
 * inséré silencieusement dans un document à valeur probante (Module
 * Tâches, Étape 4, docs/backlog.md).
 *
 * `loyerHorsCharges`/`charges` proviennent des colonnes FIGÉES de
 * `paiements` (jamais recalculées depuis les valeurs actuelles du bail —
 * voir packages/db/src/schema/paiements.ts) : une échéance générée avant
 * l'ajout de ces colonnes (2026-08-31) les a nulles, la génération bloque
 * alors explicitement plutôt que d'imprimer un montant recalculé
 * potentiellement faux.
 */
export interface DonneesCompletudeQuittance {
  nomBailleur: string | null;
  nomLocataire: string | null;
  libelleBien: string | null;
  periode: string | null;
  loyerHorsCharges: string | null;
  charges: string | null;
  dateReglement: string | null;
  villeEmission: string | null;
}

export function validerCompletudeGenerationQuittance(donnees: DonneesCompletudeQuittance): string[] {
  const manquants: string[] = [];

  if (donnees.nomBailleur === null) {
    manquants.push("Nom du bailleur");
  }
  if (donnees.nomLocataire === null) {
    manquants.push("Nom du locataire");
  }
  if (donnees.libelleBien === null) {
    manquants.push("Logement");
  }
  if (donnees.periode === null) {
    manquants.push("Période");
  }
  if (donnees.loyerHorsCharges === null) {
    manquants.push("Montant du loyer hors charges (échéance antérieure au 2026-08-31 ?)");
  }
  if (donnees.charges === null) {
    manquants.push("Montant des charges (échéance antérieure au 2026-08-31 ?)");
  }
  if (donnees.dateReglement === null) {
    manquants.push("Date de règlement");
  }
  if (donnees.villeEmission === null) {
    manquants.push("Ville d'émission");
  }

  return manquants;
}
