import { useCallback, useEffect, useRef, useState } from "react";
import { getCompletudeDocumentaire, type CompletudeCategorie } from "../tableau-de-bord/api";
import {
  remplacerDocument,
  uploadDocument,
  type DocumentCandidatRole,
  type DocumentCategorie,
  type DocumentEntiteType
} from "./api";
import { DocumentApercuModal } from "./DocumentApercuModal";
import { CATEGORIE_LABELS } from "./labels";
import { useDocumentApercu } from "./use-document-apercu";

// Catégories attendues par type d'entité — même liste que
// TableauDeBordService (docs/backlog.md, checklist documentaire). Seuls ces
// 4 types ont une checklist ; les autres (sci/immeuble/bail/etat_des_lieux/
// depense) n'en affichent aucune, DocumentsForEntite reste inchangé pour eux.
const CATEGORIES_PAR_TYPE: Partial<Record<DocumentEntiteType, true>> = {
  appartement: true,
  locataire: true,
  garant: true,
  candidat: true
};

// Affichée au-dessus de la liste générique de DocumentsForEntite : montre
// explicitement l'état de chaque catégorie attendue (présent avec lien
// voir/remplacer, ou manquant avec un bouton qui pré-sélectionne
// directement la catégorie — pas de liste déroulante générique à remplir
// soi-même). Réutilise la détection déjà écrite côté backend
// (TableauDeBordService.getCompletudeDocumentaire, lui-même basé sur
// evaluerCompletudeCategories de packages/core) plutôt que de la dupliquer.
// `role`/`titre` sont exigés uniquement pour entiteType='candidat' — deux
// checklists distinctes (candidat/garant) pour la même fiche candidat,
// voir CandidatsView (extension checklist candidat, 2026-09-15).
export function ChecklistCategoriesEntite({
  entiteType,
  entiteId,
  role,
  titre,
  onChanged
}: {
  entiteType: DocumentEntiteType;
  entiteId: string;
  role?: DocumentCandidatRole;
  titre?: string;
  onChanged: () => void;
}): React.JSX.Element | null {
  const [completude, setCompletude] = useState<CompletudeCategorie[] | null>(null);
  const applicable = CATEGORIES_PAR_TYPE[entiteType] === true;
  const { apercu, erreur: erreurApercu, ouvrir, fermer } = useDocumentApercu();

  const refresh = useCallback(async () => {
    if (!applicable) {
      return;
    }
    setCompletude(
      await getCompletudeDocumentaire(entiteType as "appartement" | "locataire" | "garant" | "candidat", entiteId, role)
    );
  }, [applicable, entiteType, entiteId, role]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!applicable || !completude) {
    return null;
  }

  return (
    <div className="space-y-1 rounded-md border border-slate-200 p-3">
      <h3 className="text-sm font-semibold text-slate-700">
        {titre ?? (entiteType === "appartement" ? "Diagnostics" : "Pièce d'identité")}
      </h3>
      <ul className="space-y-1">
        {completude.map((c) => (
          <CategorieRow
            key={c.categorie}
            entiteType={entiteType}
            entiteId={entiteId}
            {...(role && { candidatRole: role })}
            completude={c}
            onVoir={ouvrir}
            onChanged={async () => {
              await refresh();
              onChanged();
            }}
          />
        ))}
      </ul>

      {apercu && <DocumentApercuModal apercu={apercu} onClose={fermer} />}
      {erreurApercu && (
        <p role="alert" className="text-sm text-red-600">
          {erreurApercu}
        </p>
      )}
    </div>
  );
}

function CategorieRow({
  entiteType,
  entiteId,
  candidatRole,
  completude,
  onVoir,
  onChanged
}: {
  entiteType: DocumentEntiteType;
  entiteId: string;
  candidatRole?: DocumentCandidatRole;
  completude: CompletudeCategorie;
  onVoir: (id: string) => Promise<void>;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categorie = completude.categorie as DocumentCategorie;

  async function handleFichierChoisi(fichier: File): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    try {
      if (completude.document) {
        await remplacerDocument(completude.document.id, fichier, { categorie });
      } else {
        await uploadDocument(fichier, { entiteType, entiteId, categorie, ...(candidatRole && { candidatRole }) });
      }
      await onChanged();
    } catch {
      setError("Échec de l'envoi (20 Mo max)");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className={completude.document ? "text-emerald-700" : "text-slate-500"}>
        {completude.document ? "✓" : "✗"} {CATEGORIE_LABELS[categorie]}
        {completude.document ? ` présent (${completude.document.nomFichier})` : " — manquant"}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {completude.document && (
          <button
            type="button"
            onClick={() => {
              void onVoir(completude.document!.id);
            }}
            className="text-xs text-indigo-700 underline hover:text-indigo-800"
          >
            Voir
          </button>
        )}
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => inputRef.current?.click()}
          className="text-xs text-indigo-700 underline hover:text-indigo-800 disabled:opacity-50"
        >
          {isSubmitting ? "Envoi…" : completude.document ? "Remplacer" : "+ Ajouter"}
        </button>
      </span>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const fichier = event.target.files?.[0];
          event.target.value = "";
          if (fichier) {
            void handleFichierChoisi(fichier);
          }
        }}
      />
      {error && (
        <p role="alert" className="w-full text-xs text-red-600">
          {error}
        </p>
      )}
    </li>
  );
}
