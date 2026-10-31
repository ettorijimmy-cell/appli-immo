// Erreur plate (pas une exception NestJS — même principe que
// GotenbergIndisponibleError/GotenbergConversionError, voir gotenberg/
// gotenberg.errors.ts) : levée par EtatDesLieuxDocumentDocxService quand
// une image de signature déjà posée (etat_des_lieux_signature.documentId)
// ne peut plus être lue (fichier absent ou illisible sur le stockage,
// contenu corrompu) — l'appelant (EtatDesLieuxPdfService.produireManuellement)
// la traduit en réponse HTTP au bord de l'application, jamais ici.
export class SignatureIllisibleError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SignatureIllisibleError";
  }
}
