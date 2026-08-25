import type { ApercuDocument } from "./use-document-apercu";

// Même convention de modale que PhotosPiece (etats-des-lieux/PieceGrid.tsx)
// — fond noir plein écran, clic sur le fond ferme, clic sur le contenu ne
// propage pas. PDF via <embed> (lecteur intégré de Chromium, comme pour un
// <iframe> pointant sur une URL blob:), image via <img> — même mécanisme
// que PhotoThumbnail, déjà vérifié dans ce contexte Electron durci.
export function DocumentApercuModal({
  apercu,
  onClose
}: {
  apercu: ApercuDocument;
  onClose: () => void;
}): React.JSX.Element {
  const estImage = apercu.mimeType.startsWith("image/");

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <span className="truncate text-sm font-medium text-slate-700">{apercu.nomFichier}</span>
          <div className="flex shrink-0 items-center gap-4">
            <a
              href={apercu.blobUrl}
              download={apercu.nomFichier}
              className="text-xs text-indigo-700 underline hover:text-indigo-800"
            >
              Télécharger
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              Fermer
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-slate-50 p-2">
          {estImage ? (
            <img
              src={apercu.blobUrl}
              alt={apercu.nomFichier}
              className="mx-auto max-h-full max-w-full object-contain"
            />
          ) : (
            <embed src={apercu.blobUrl} type={apercu.mimeType} className="h-full w-full" />
          )}
        </div>
      </div>
    </div>
  );
}
