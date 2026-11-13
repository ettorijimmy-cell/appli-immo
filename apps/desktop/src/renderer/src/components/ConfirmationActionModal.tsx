import { useRef, useState } from "react";
import { creerActionConfirmee, type EtatActionConfirmee } from "../lib/action-confirmee";
import { Modale } from "./Modale";

// Confirmation commune avant une action destructrice ou d'archivage :
// l'action n'est lancée qu'au clic sur le bouton de confirmation, une seule
// fois (lib/action-confirmee.ts) ; en cas d'échec, le message de l'API (ou
// `messageRepli`) reste affiché dans la modale, qui reste ouverte — rien
// n'est avalé. `onTermine` n'est appelé qu'après un succès : c'est à
// l'appelant de fermer la modale et de rafraîchir son écran.
export function ConfirmationActionModal({
  titre,
  objet,
  explication,
  libelleConfirmer,
  libelleEnCours,
  action,
  messageRepli,
  onTermine,
  onAnnuler,
  ton = "neutre"
}: {
  titre: string;
  // Ce sur quoi porte l'action (nom de fichier, nom du locataire...).
  objet?: string;
  // Ce qui va se passer, et si c'est réversible.
  explication: string;
  libelleConfirmer: string;
  libelleEnCours: string;
  action: () => Promise<unknown>;
  messageRepli: string;
  onTermine: () => void;
  onAnnuler: () => void;
  // « danger » : bouton de confirmation rouge, pour une action définitive
  // (résiliation du bail) — même rouge que l'abandon de brouillon.
  ton?: "neutre" | "danger";
}): React.JSX.Element {
  const [etat, setEtat] = useState<EtatActionConfirmee>({ statut: "attente" });
  // Dernière version des props : la machine d'état est créée une seule fois
  // (son verrou anti double clic doit survivre aux rendus).
  const actionCourante = useRef(action);
  actionCourante.current = action;
  const [confirmation] = useState(() =>
    creerActionConfirmee({ action: () => actionCourante.current(), messageRepli, surChangement: setEtat })
  );
  const enCours = etat.statut === "en_cours";

  async function confirmer(): Promise<void> {
    if (await confirmation.confirmer()) {
      onTermine();
    }
  }

  function annuler(): void {
    if (confirmation.annuler()) {
      onAnnuler();
    }
  }

  return (
    <Modale titre={titre}>
      {objet && <p className="break-all text-sm text-slate-700">{objet}</p>}
      <p className="text-sm text-slate-600">{explication}</p>
      {etat.statut === "echec" && (
        <p role="alert" className="text-sm text-red-600">
          {etat.message}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={annuler}
          disabled={enCours}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void confirmer()}
          disabled={enCours}
          className={`rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50 ${
            ton === "danger" ? "bg-red-700 hover:bg-red-800" : "bg-indigo-700 hover:bg-indigo-800"
          }`}
        >
          {enCours ? libelleEnCours : libelleConfirmer}
        </button>
      </div>
    </Modale>
  );
}
