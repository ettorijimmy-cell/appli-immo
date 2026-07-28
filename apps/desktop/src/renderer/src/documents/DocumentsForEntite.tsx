import { useCallback, useEffect, useState } from "react";
import { archiveDocument, listDocuments, ouvrirDocument, type DocumentEntiteType, type DocumentMetier } from "./api";
import { DocumentUploadDropzone } from "./DocumentUploadDropzone";
import { CATEGORIE_LABELS, STATUT_BADGE_CLASSNAMES, STATUT_LABELS } from "./labels";

// Section Documents embarquée dans une fiche (locataire, appartement...) —
// même composant que l'écran centralisé (documents/api.ts), scopé à une
// seule entité via entiteType/entiteId (lien polymorphe, Module 4).
export function DocumentsForEntite({
  entiteType,
  entiteId
}: {
  entiteType: DocumentEntiteType;
  entiteId: string;
}): React.JSX.Element {
  const [documents, setDocuments] = useState<DocumentMetier[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setDocuments(await listDocuments({ entiteType, entiteId }));
    } finally {
      setIsLoading(false);
    }
  }, [entiteType, entiteId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleArchive(id: string): Promise<void> {
    await archiveDocument(id);
    await refresh();
  }

  return (
    <div className="space-y-3">
      <DocumentUploadDropzone entiteType={entiteType} entiteId={entiteId} onUploaded={refresh} />

      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun document.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void ouvrirDocument(document.id);
                  }}
                  className="text-indigo-700 hover:text-indigo-800 hover:underline"
                >
                  {document.nomFichier}
                </button>
                <span className="text-xs text-slate-400">({CATEGORIE_LABELS[document.categorie]})</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BADGE_CLASSNAMES[document.statut]}`}
                >
                  {STATUT_LABELS[document.statut]}
                </span>
              </div>
              {document.statut !== "archive" && (
                <button
                  type="button"
                  onClick={() => {
                    void handleArchive(document.id);
                  }}
                  className="text-xs text-slate-500 hover:text-red-600"
                >
                  Archiver
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
