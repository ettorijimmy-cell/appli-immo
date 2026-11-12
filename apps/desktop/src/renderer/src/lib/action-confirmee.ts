import { messageErreurApi } from "./message-erreur-api";

// Machine d'état d'une action soumise à confirmation (archivage, retrait...),
// sans React : l'action est injectée, ce qui permet de vérifier en test
// qu'elle n'est jamais appelée sans confirmation, qu'elle ne l'est qu'une
// fois même sur un double clic, et que tout échec produit un message
// affichable (rien n'est avalé).
//
//   attente ──confirmer──▶ en_cours ──succès──▶ terminee
//      │                      │
//      │                      └──échec──▶ echec ──confirmer──▶ en_cours
//      └──annuler──▶ annulee      (echec ──annuler──▶ annulee)
//
// Pendant l'appel (en_cours), confirmer et annuler sont sans effet : la
// modale garde ses deux boutons désactivés, mais un second clic arrivé
// avant le rendu suivant ne doit pas relancer l'action pour autant.
export type EtatActionConfirmee =
  | { statut: "attente" }
  | { statut: "en_cours" }
  | { statut: "echec"; message: string }
  | { statut: "terminee" }
  | { statut: "annulee" };

export interface ActionConfirmee {
  etat: () => EtatActionConfirmee;
  // true si l'action a abouti (l'appelant ferme alors la confirmation).
  confirmer: () => Promise<boolean>;
  // true si l'annulation est acceptée (refusée pendant l'appel).
  annuler: () => boolean;
}

export function creerActionConfirmee({
  action,
  messageRepli,
  surChangement
}: {
  action: () => Promise<unknown>;
  // Message affiché quand l'erreur n'a pas de message exploitable
  // (réseau, générique NestJS) — voir messageErreurApi.
  messageRepli: string;
  surChangement?: (etat: EtatActionConfirmee) => void;
}): ActionConfirmee {
  let etat: EtatActionConfirmee = { statut: "attente" };

  function passerA(suivant: EtatActionConfirmee): void {
    etat = suivant;
    surChangement?.(suivant);
  }

  return {
    etat: () => etat,

    async confirmer(): Promise<boolean> {
      if (etat.statut !== "attente" && etat.statut !== "echec") {
        return false;
      }
      passerA({ statut: "en_cours" });
      try {
        await action();
      } catch (erreur) {
        passerA({ statut: "echec", message: messageErreurApi(erreur, messageRepli) });
        return false;
      }
      passerA({ statut: "terminee" });
      return true;
    },

    annuler(): boolean {
      if (etat.statut !== "attente" && etat.statut !== "echec") {
        return false;
      }
      passerA({ statut: "annulee" });
      return true;
    }
  };
}
