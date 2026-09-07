import { useCallback, useEffect, useState, type FormEvent } from "react";
import { libelleBien, listBiens, type Bien } from "../patrimoine/api";
import { listScis, type Sci } from "../scis/api";
import {
  createDepense,
  listDepenses,
  DEPENSE_CATEGORIES,
  DEPENSE_CATEGORIE_LABELS,
  type Depense,
  type DepenseCategorie
} from "./api";

export function DepensesListView(): React.JSX.Element {
  const [depenses, setDepenses] = useState<Depense[]>([]);
  const [biens, setBiens] = useState<Bien[]>([]);
  const [scis, setScis] = useState<Sci[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filtreCategorie, setFiltreCategorie] = useState<DepenseCategorie | "toutes">("toutes");

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [depensesBrutes, biensBruts, scisBrutes] = await Promise.all([listDepenses(), listBiens(), listScis()]);
      setDepenses(depensesBrutes);
      setBiens(biensBruts);
      setScis(scisBrutes);
      setError(null);
    } catch {
      setError("Impossible de charger les dépenses");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const bienParId = new Map(biens.map((bien) => [bien.id, bien]));
  const sciParId = new Map(scis.map((sci) => [sci.id, sci]));

  function libelleRattachement(depense: Depense): string {
    if (depense.bienId) {
      const bien = bienParId.get(depense.bienId);
      return bien ? libelleBien(bien) : "Bien inconnu";
    }
    if (depense.sciId) {
      const sci = sciParId.get(depense.sciId);
      return sci ? sci.nom : "SCI inconnue";
    }
    return "—";
  }

  const visibles = depenses.filter((d) => (filtreCategorie === "toutes" ? true : d.categorie === filtreCategorie));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Dépenses</h1>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
        >
          {showForm ? "Annuler" : "Nouvelle dépense"}
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        Catégorie
        <select
          id="depenses-filtre-categorie"
          value={filtreCategorie}
          onChange={(e) => setFiltreCategorie(e.target.value as DepenseCategorie | "toutes")}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="toutes">Toutes</option>
          {DEPENSE_CATEGORIES.map((categorie) => (
            <option key={categorie} value={categorie}>
              {DEPENSE_CATEGORIE_LABELS[categorie]}
            </option>
          ))}
        </select>
      </label>

      {showForm && (
        <NewDepenseForm
          biens={biens}
          scis={scis}
          onCreated={() => {
            setShowForm(false);
            void refresh();
          }}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : visibles.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune dépense pour le moment.</p>
      ) : (
        <div className="space-y-2">
          {visibles.map((depense) => (
            <div
              key={depense.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 p-4 text-sm"
            >
              <span>
                {depense.dateDepense} — {depense.montant} € — {depense.libelle}
              </span>
              <span className="text-slate-500">
                {DEPENSE_CATEGORIE_LABELS[depense.categorie]} · {libelleRattachement(depense)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewDepenseForm({
  biens,
  scis,
  onCreated
}: {
  biens: Bien[];
  scis: Sci[];
  onCreated: () => void;
}): React.JSX.Element {
  const [categorie, setCategorie] = useState<DepenseCategorie>("reparation_entretien");
  const [montant, setMontant] = useState("");
  const [dateDepense, setDateDepense] = useState("");
  const [libelle, setLibelle] = useState("");
  // Rattachement : soit un bien précis, soit une SCI seule (dépense de
  // niveau SCI, sans bien précis — frais de gestion, comptable). Encodé en
  // une seule valeur de select ("bien:<id>" / "sci:<id>") pour n'avoir
  // qu'un seul menu déroulant, plutôt que deux qui s'excluraient l'un
  // l'autre.
  const [rattachement, setRattachement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!rattachement) {
      setError("Un bien ou une SCI de rattachement est requis");
      return;
    }
    setIsSubmitting(true);
    try {
      const [type, id] = rattachement.split(":");
      if (!id) {
        throw new Error("Rattachement invalide");
      }
      await createDepense({
        categorie,
        montant,
        dateDepense,
        libelle,
        ...(type === "bien" ? { bienId: id } : { sciId: id })
      });
      setMontant("");
      setDateDepense("");
      setLibelle("");
      setRattachement("");
      onCreated();
    } catch {
      setError("Impossible de créer la dépense");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-4 rounded-lg border border-slate-200 p-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="depense-rattachement" className="text-sm font-medium text-slate-700">
            Bien / SCI
          </label>
          <select
            id="depense-rattachement"
            value={rattachement}
            onChange={(e) => setRattachement(e.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              Sélectionner…
            </option>
            {biens.map((bien) => (
              <option key={bien.id} value={`bien:${bien.id}`}>
                {libelleBien(bien)}
              </option>
            ))}
            {scis.map((sci) => (
              <option key={sci.id} value={`sci:${sci.id}`}>
                {sci.nom} (SCI, sans bien précis)
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="depense-categorie" className="text-sm font-medium text-slate-700">
            Catégorie
          </label>
          <select
            id="depense-categorie"
            value={categorie}
            onChange={(e) => setCategorie(e.target.value as DepenseCategorie)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {DEPENSE_CATEGORIES.map((valeur) => (
              <option key={valeur} value={valeur}>
                {DEPENSE_CATEGORIE_LABELS[valeur]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="depense-montant" className="text-sm font-medium text-slate-700">
            Montant (€)
          </label>
          <input
            id="depense-montant"
            type="text"
            inputMode="decimal"
            value={montant}
            onChange={(e) => setMontant(e.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="depense-date" className="text-sm font-medium text-slate-700">
            Date
          </label>
          <input
            id="depense-date"
            type="date"
            value={dateDepense}
            onChange={(e) => setDateDepense(e.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="col-span-2 space-y-1">
          <label htmlFor="depense-libelle" className="text-sm font-medium text-slate-700">
            Libellé
          </label>
          <input
            id="depense-libelle"
            type="text"
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
      >
        {isSubmitting ? "Création…" : "Créer la dépense"}
      </button>
    </form>
  );
}
