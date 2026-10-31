import type { StatutDocumentsFigesPhase } from "./api";

// Au-delà de ce délai sans PDF après la production du .docx figé, on
// considère que la conversion a réellement échoué plutôt que d'être
// "en cours" — la chaîne en arrière-plan (signature, job planifié,
// relance à la lecture) tente la conversion quasi immédiatement après le
// .docx ; passé une marge large, un PDF toujours absent n'est plus un
// simple délai normal. 30 minutes : largement au-dessus du pire temps de
// conversion observé (quelques secondes à quelques dizaines de secondes,
// cold start Gotenberg compris — voir GotenbergConfig.timeoutMs, 60s),
// sans déclencher trop tôt sur une machine chargée.
const SEUIL_EN_PREPARATION_MS = 30 * 60 * 1000;

// Dérive le libellé affiché (DocumentsFigesCard) à partir de la seule
// information renvoyée par GET :id/pdf — pas de champ d'erreur dédié côté
// backend (chantier PDF étape 4) : PDF présent -> "Prêt" (sa date de
// production) ; .docx présent depuis moins de 30 minutes sans le PDF ->
// "En préparation" (conversion en cours ou retentée très prochainement) ;
// .docx présent depuis plus de 30 minutes sans le PDF -> "Échec de la
// conversion" (le bouton "Produire le PDF" reste affiché dans ce cas,
// voir DocumentsFigesCard) ; ni l'un ni l'autre -> "Indisponible".
// `maintenant` injectable (tests) — new Date() par défaut.
export function libelleStatutPdf(statut: StatutDocumentsFigesPhase | undefined, maintenant: Date = new Date()): string {
  if (statut?.pdf) {
    return `Prêt (${new Date(statut.pdf.createdAt).toLocaleDateString("fr-FR")})`;
  }
  if (!statut?.docx) {
    return "Indisponible";
  }
  const ageDocxMs = maintenant.getTime() - new Date(statut.docx.createdAt).getTime();
  return ageDocxMs < SEUIL_EN_PREPARATION_MS ? "En préparation" : "Échec de la conversion";
}
