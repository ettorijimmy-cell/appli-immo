import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { libelleBien, listAppartements, listBiens, type Appartement, type Bien } from "../patrimoine/api";
import { listScis, type Sci } from "../scis/api";
import {
  createDepense,
  listDepenses,
  previsualiserRepartition,
  repartirEntreLots,
  DEPENSE_CATEGORIES,
  DEPENSE_CATEGORIE_LABELS,
  type ApercuRepartition,
  type Depense,
  type DepenseCategorie
} from "./api";

export function DepensesListView(): React.JSX.Element {
  const [depenses, setDepenses] = useState<Depense[]>([]);
  const [biens, setBiens] = useState<Bien[]>([]);
  const [scis, setScis] = useState<Sci[]>([]);
  const [appartements, setAppartements] = useState<Appartement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filtreCategorie, setFiltreCategorie] = useState<DepenseCategorie | "toutes">("toutes");
  const [depenseARepartir, setDepenseARepartir] = useState<Depense | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [depensesBrutes, biensBruts, scisBrutes, appartementsBruts] = await Promise.all([
        listDepenses(),
        listBiens(),
        listScis(),
        listAppartements()
      ]);
      setDepenses(depensesBrutes);
      setBiens(biensBruts);
      setScis(scisBrutes);
      setAppartements(appartementsBruts);
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

  // Module Régularisation des charges, Sous-commit D : une dépense peut
  // être répartie entre les lots uniquement si elle est de niveau bien
  // (jamais déjà rattachée à un appartement précis), que ce bien est un
  // immeuble à plusieurs lots éligibles (non archivés), et qu'elle n'a pas
  // déjà été répartie (ni elle-même un enfant d'une répartition, ni déjà
  // dotée d'enfants). Calculé une fois pour tout l'écran plutôt que
  // recalculé à chaque rendu de ligne.
  const idsDejaRepartis = useMemo(
    () => new Set(depenses.map((d) => d.depenseSourceId).filter((id): id is string => id !== null)),
    [depenses]
  );
  const nombreLotsEligiblesParBien = useMemo(() => {
    const compte = new Map<string, number>();
    for (const appartement of appartements) {
      // Les deux conditions reflètent exactement le filtre backend
      // (statut <> 'archive' ET archivedAt IS NULL) — revue
      // financial-logic-reviewer 2026-10-02, les deux champs sont
      // toujours posés ensemble en pratique mais ne pas s'appuyer
      // uniquement sur statut reste plus sûr si ça change un jour.
      if (appartement.statut === "archive" || appartement.archivedAt !== null) continue;
      compte.set(appartement.bienId, (compte.get(appartement.bienId) ?? 0) + 1);
    }
    return compte;
  }, [appartements]);

  function peutEtreRepartie(depense: Depense): boolean {
    if (!depense.bienId || depense.appartementId || depense.depenseSourceId) {
      return false;
    }
    if (idsDejaRepartis.has(depense.id)) {
      return false;
    }
    const bien = bienParId.get(depense.bienId);
    if (!bien || bien.type !== "immeuble") {
      return false;
    }
    return (nombreLotsEligiblesParBien.get(depense.bienId) ?? 0) >= 2;
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
              <div className="flex items-center gap-3">
                <span className="text-slate-500">
                  {DEPENSE_CATEGORIE_LABELS[depense.categorie]} · {libelleRattachement(depense)}
                </span>
                {peutEtreRepartie(depense) && (
                  <button
                    type="button"
                    onClick={() => setDepenseARepartir(depense)}
                    className="rounded-md border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    Répartir entre les lots
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {depenseARepartir && (
        <RepartitionModal
          depense={depenseARepartir}
          onClose={() => setDepenseARepartir(null)}
          onRepartie={() => {
            setDepenseARepartir(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

// Opération irréversible (la dépense source passe à 0.00, son montant
// original n'est plus conservé qu'en texte dans le libellé) — jamais
// d'exécution silencieuse : l'aperçu (base utilisée + part de chaque lot)
// est systématiquement affiché avant toute confirmation.
function RepartitionModal({
  depense,
  onClose,
  onRepartie
}: {
  depense: Depense;
  onClose: () => void;
  onRepartie: () => void;
}): React.JSX.Element {
  const [apercu, setApercu] = useState<ApercuRepartition | null>(null);
  const [isLoadingApercu, setIsLoadingApercu] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    setIsLoadingApercu(true);
    setError(null);
    previsualiserRepartition(depense.id)
      .then((resultat) => {
        if (!annule) setApercu(resultat);
      })
      .catch(() => {
        if (!annule) setError("Impossible de calculer l'aperçu de la répartition.");
      })
      .finally(() => {
        if (!annule) setIsLoadingApercu(false);
      });
    return () => {
      annule = true;
    };
  }, [depense.id]);

  async function confirmer(): Promise<void> {
    setIsConfirming(true);
    setError(null);
    try {
      await repartirEntreLots(depense.id);
      onRepartie();
    } catch {
      setError("Impossible de répartir cette dépense entre les lots.");
      setIsConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-base font-semibold">Répartir entre les lots</h2>
        <p className="text-sm text-slate-600">
          {depense.libelle} — {depense.montant} €
        </p>

        {isLoadingApercu ? (
          <p className="text-sm text-slate-500">Calcul de l'aperçu…</p>
        ) : error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : apercu ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">
              Clé de répartition : <strong>{apercu.cle === "tantieme" ? "tantième" : "surface"}</strong>
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-1">Lot</th>
                  <th className="pb-1 text-right">Part</th>
                </tr>
              </thead>
              <tbody>
                {apercu.parts.map((part) => (
                  <tr key={part.appartementId}>
                    <td>{part.numero}</td>
                    <td className="text-right">{part.montant} €</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500">
              Cette opération est irréversible : la dépense d'origine sera mise à 0,00 € (montant conservé dans son
              libellé) et une dépense sera créée pour chaque lot ci-dessus.
            </p>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isConfirming}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => {
              void confirmer();
            }}
            disabled={isLoadingApercu || isConfirming || !apercu}
            className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
          >
            {isConfirming ? "Répartition…" : "Confirmer la répartition"}
          </button>
        </div>
      </div>
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
