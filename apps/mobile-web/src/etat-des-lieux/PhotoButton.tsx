import { useRef, useState } from "react";
import { uploaderPhotoEtatDesLieux } from "../api/documents";

// Bouton "+ Photo" par pièce (pas par élément), décision actée — upload
// immédiat dès la sélection, indépendant du cycle Suivant/Précédent
// (jamais bloquant sur la saisie des éléments de la pièce).
// capture="environment" : ouvre directement l'appareil photo arrière sur
// mobile plutôt que la galerie, plus rapide en visite.
export function PhotoButton({ etatDesLieuxId }: { etatDesLieuxId: string }): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nombreEnvoyees, setNombreEnvoyees] = useState(0);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const fichier = event.target.files?.[0];
    if (!fichier) {
      return;
    }
    setError(null);
    setIsUploading(true);
    try {
      await uploaderPhotoEtatDesLieux(etatDesLieuxId, fichier);
      setNombreEnvoyees((n) => n + 1);
    } catch {
      setError("Envoi impossible — réessayez");
    } finally {
      setIsUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        className="w-full rounded-md border border-slate-300 bg-white py-3 text-base font-medium text-slate-700 disabled:opacity-50"
      >
        {isUploading ? "Envoi…" : `+ Photo${nombreEnvoyees > 0 ? ` (${nombreEnvoyees})` : ""}`}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => void handleChange(event)}
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
