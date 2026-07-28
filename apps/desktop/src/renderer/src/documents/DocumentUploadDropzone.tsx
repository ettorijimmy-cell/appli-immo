import { useRef, useState, type DragEvent } from "react";
import { uploadDocument, type DocumentCategorie, type DocumentEntiteType } from "./api";
import { CATEGORIE_LABELS } from "./labels";

const CATEGORIES: DocumentCategorie[] = [
  "bail",
  "assurance",
  "etat_des_lieux",
  "diagnostic",
  "dpe",
  "piece_identite",
  "rib",
  "caf",
  "quittance",
  "courrier",
  "photo"
];

// Glisser-déposer depuis une fiche (parcours cible de la Phase 6,
// docs/backlog.md, Module 4) — réutilisable sur n'importe laquelle des 5
// fiches (sci/immeuble/appartement/locataire/bail) puisque le lien est
// polymorphe. La catégorie n'étant pas déductible du fichier lui-même, le
// dépôt ouvre un petit formulaire de confirmation avant l'upload effectif.
export function DocumentUploadDropzone({
  entiteType,
  entiteId,
  onUploaded
}: {
  entiteType: DocumentEntiteType;
  entiteId: string;
  onUploaded: () => void;
}): React.JSX.Element {
  const [isDragging, setIsDragging] = useState(false);
  const [fichierEnAttente, setFichierEnAttente] = useState<File | null>(null);
  const [categorie, setCategorie] = useState<DocumentCategorie>("bail");
  const [dateExpiration, setDateExpiration] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);
    const fichier = event.dataTransfer.files[0];
    if (fichier) {
      setFichierEnAttente(fichier);
      setError(null);
    }
  }

  async function handleConfirmer(): Promise<void> {
    if (!fichierEnAttente) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await uploadDocument(fichierEnAttente, {
        entiteType,
        entiteId,
        categorie,
        ...(dateExpiration && { dateExpiration })
      });
      setFichierEnAttente(null);
      setDateExpiration("");
      setCategorie("bail");
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      onUploaded();
    } catch {
      setError("Impossible d'envoyer ce document (20 Mo max)");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (fichierEnAttente) {
    return (
      <div className="space-y-3 rounded-md border border-slate-200 p-3">
        <p className="text-sm">
          <span className="font-medium">{fichierEnAttente.name}</span>{" "}
          <span className="text-slate-400">({Math.ceil(fichierEnAttente.size / 1024)} Ko)</span>
        </p>
        <div className="flex items-center gap-3">
          <select
            value={categorie}
            onChange={(event) => setCategorie(event.target.value as DocumentCategorie)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {CATEGORIES.map((valeur) => (
              <option key={valeur} value={valeur}>
                {CATEGORIE_LABELS[valeur]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            Expiration
            <input
              type="date"
              value={dateExpiration}
              onChange={(event) => setDateExpiration(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              void handleConfirmer();
            }}
            className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
          >
            {isSubmitting ? "Envoi…" : "Ajouter le document"}
          </button>
          <button
            type="button"
            onClick={() => {
              setFichierEnAttente(null);
              setError(null);
            }}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`rounded-md border-2 border-dashed p-4 text-center text-sm ${
        isDragging ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500"
      }`}
    >
      <p>
        Glisser un document ici, ou{" "}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-indigo-700 underline hover:text-indigo-800"
        >
          parcourir
        </button>
      </p>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const fichier = event.target.files?.[0];
          if (fichier) {
            setFichierEnAttente(fichier);
          }
        }}
      />
    </div>
  );
}
