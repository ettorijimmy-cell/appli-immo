import { useState } from "react";
import { Modale } from "../etats-des-lieux/BrouillonEtatDesLieux";
import { archiveDocument, type DocumentMetier } from "./api";
import { MESSAGE_CONFIRMATION_ARCHIVAGE_PHOTO, messageErreurArchivage } from "./archivage-document";

// Confirmation avant d'archiver une photo, partagée par l'état des lieux
// (sous les miniatures) et l'écran Documents. En cas de refus, le message
// du backend reste affiché dans la modale.
export function ConfirmationArchivagePhotoModal({
  document,
  onAnnuler,
  onArchive
}: {
  document: Pick<DocumentMetier, "id" | "nomFichier" | "categorie">;
  onAnnuler: () => void;
  onArchive: () => void;
}): React.JSX.Element {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function confirmer(): Promise<void> {
    setEnCours(true);
    setErreur(null);
    try {
      await archiveDocument(document.id);
    } catch (err) {
      setErreur(messageErreurArchivage(err, document));
      setEnCours(false);
      return;
    }
    onArchive();
  }

  return (
    <Modale titre="Archiver la photo ?">
      <p className="break-all text-sm text-slate-700">{document.nomFichier}</p>
      <p className="text-sm text-slate-600">{MESSAGE_CONFIRMATION_ARCHIVAGE_PHOTO}</p>
      {erreur && (
        <p role="alert" className="text-sm text-red-600">
          {erreur}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onAnnuler}
          disabled={enCours}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void confirmer()}
          disabled={enCours}
          className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {enCours ? "Archivage…" : "Archiver la photo"}
        </button>
      </div>
    </Modale>
  );
}
