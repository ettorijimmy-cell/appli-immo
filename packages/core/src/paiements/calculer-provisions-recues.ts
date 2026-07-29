import { centimesVersMontant, montantEnCentimes } from "./montant";

/**
 * Part des provisions pour charges dans un montant reçu sur une échéance
 * `type=loyer` (docs/data-dictionary.md, section paiements — "Provisions
 * collectées", Module 7). `paiements.montant` ne distingue jamais loyer et
 * provisions_charges (une seule colonne, voir calculerMontantEcheanceLoyer)
 * : ce calcul est une ESTIMATION dérivée, pas une valeur directement
 * stockée.
 *
 * `montantRecu` = `montant_paye` (ou `montant` si l'échéance est
 * intégralement payée) — pas nécessairement le montant plein mensuel :
 * fonctionne aussi bien sur une échéance proratisée (entrée, résiliation)
 * qu'un paiement partiel, puisque la proportion s'applique directement au
 * montant réellement reçu plutôt qu'à un forfait mensuel.
 *
 * Hypothèse résiduelle, non réduite par cette formule (à ne jamais
 * présenter comme résolue) : `loyerMensuel`/`provisionsCharges` sont les
 * valeurs ACTUELLES du bail, jamais un instantané historique au moment où
 * l'échéance a été générée — si ces valeurs ont été révisées depuis, le
 * ratio appliqué à une échéance antérieure à la révision est tout aussi
 * faux qu'un montant forfaitaire l'aurait été. Cette limite est identique,
 * pas amoindrie, par rapport à un calcul non proportionnel.
 */
export function calculerProvisionsRecuesEcheance(
  montantRecu: string,
  loyerMensuel: string,
  provisionsCharges: string | null
): string {
  const centimesProvisions = provisionsCharges ? montantEnCentimes(provisionsCharges) : 0;
  if (centimesProvisions <= 0) {
    return "0.00";
  }
  const centimesLoyer = montantEnCentimes(loyerMensuel);
  const centimesTotal = centimesLoyer + centimesProvisions;
  if (centimesTotal <= 0) {
    return "0.00";
  }
  const centimesRecus = montantEnCentimes(montantRecu);
  const centimesProvisionsRecues = Math.trunc((centimesRecus * centimesProvisions) / centimesTotal);
  return centimesVersMontant(centimesProvisionsRecues);
}

/**
 * Part LOYER (hors provisions) d'un montant reçu — complémentaire de
 * calculerProvisionsRecuesEcheance, réutilisée telle quelle (jamais un
 * second calcul de ratio indépendant) : soustraction en centimes entiers,
 * garantissant `loyerNet + provisions = montantRecu` exactement, sans
 * dérive d'arrondi entre les deux valeurs (docs/data-dictionary.md,
 * section paiements — "Revenus locatifs", Module 7).
 */
export function calculerLoyerNetRecuEcheance(
  montantRecu: string,
  loyerMensuel: string,
  provisionsCharges: string | null
): string {
  const centimesRecus = montantEnCentimes(montantRecu);
  const centimesProvisions = montantEnCentimes(
    calculerProvisionsRecuesEcheance(montantRecu, loyerMensuel, provisionsCharges)
  );
  return centimesVersMontant(centimesRecus - centimesProvisions);
}
