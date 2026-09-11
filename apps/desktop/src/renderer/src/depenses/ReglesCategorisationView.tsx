import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  archiveRegleCategorisation,
  createRegleCategorisation,
  listReglesCategorisation,
  DEPENSE_CATEGORIES,
  DEPENSE_CATEGORIE_LABELS,
  type DepenseCategorie,
  type RegleCategorisation
} from "./api";

// Écran de gestion des règles mot-clé -> catégorie (Module Charges et
// fiscalité, Étape 2) : Jimmy en ajoute au fil de l'usage réel de l'import
// CSV, pas un script de seed. Ne fait QUE présélectionner une catégorie
// dans ImportCsvDepensesView — jamais une catégorisation automatique.
export function ReglesCategorisationView(): React.JSX.Element {
  const [regles, setRegles] = useState<RegleCategorisation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [motCle, setMotCle] = useState("");
  const [categorie, setCategorie] = useState<DepenseCategorie>("autre");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [archivageEnCours, setArchivageEnCours] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setRegles(await listReglesCategorisation());
      setError(null);
    } catch {
      setError("Impossible de charger les règles de catégorisation");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createRegleCategorisation({ motCle, categorie });
      setMotCle("");
      await refresh();
    } catch {
      setError("Impossible de créer cette règle");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRetirer(id: string): Promise<void> {
    setArchivageEnCours(id);
    try {
      await archiveRegleCategorisation(id);
      await refresh();
    } catch {
      setError("Impossible de retirer cette règle");
    } finally {
      setArchivageEnCours(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Règles de catégorisation</h1>
      <p className="text-sm text-slate-500">
        Une règle présélectionne une catégorie dans l'import CSV quand son mot-clé se retrouve dans
        le libellé d'une ligne — rien n'est jamais catégorisé automatiquement, la confirmation
        manuelle reste obligatoire. Si plusieurs règles correspondent à un même libellé, aucune
        suggestion n'est faite.
      </p>

      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-4"
      >
        <div className="space-y-1">
          <label htmlFor="regle-mot-cle" className="text-sm font-medium text-slate-700">
            Mot-clé
          </label>
          <input
            id="regle-mot-cle"
            type="text"
            value={motCle}
            onChange={(e) => setMotCle(e.target.value)}
            required
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="regle-categorie" className="text-sm font-medium text-slate-700">
            Catégorie
          </label>
          <select
            id="regle-categorie"
            value={categorie}
            onChange={(e) => setCategorie(e.target.value as DepenseCategorie)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {DEPENSE_CATEGORIES.map((valeur) => (
              <option key={valeur} value={valeur}>
                {DEPENSE_CATEGORIE_LABELS[valeur]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {isSubmitting ? "Ajout…" : "Ajouter la règle"}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : regles.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune règle pour le moment.</p>
      ) : (
        <div className="space-y-2">
          {regles.map((regle) => (
            <div
              key={regle.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 p-4 text-sm"
            >
              <span>
                <span className="font-medium">{regle.motCle}</span> → {DEPENSE_CATEGORIE_LABELS[regle.categorie]}
              </span>
              <button
                type="button"
                onClick={() => {
                  void handleRetirer(regle.id);
                }}
                disabled={archivageEnCours === regle.id}
                className="text-xs text-slate-500 hover:text-red-600 disabled:opacity-50"
              >
                Retirer
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
