import { ConfirmationActionModal } from "../components/ConfirmationActionModal";
import { archiveDocument, type DocumentMetier } from "./api";
import { MESSAGE_CONFIRMATION_ARCHIVAGE_PHOTO, messageRepliArchivage } from "./archivage-document";

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
  return (
    <ConfirmationActionModal
      titre="Archiver la photo ?"
      objet={document.nomFichier}
      explication={MESSAGE_CONFIRMATION_ARCHIVAGE_PHOTO}
      libelleConfirmer="Archiver la photo"
      libelleEnCours="Archivage…"
      action={() => archiveDocument(document.id)}
      messageRepli={messageRepliArchivage(document)}
      onTermine={onArchive}
      onAnnuler={onAnnuler}
    />
  );
}
