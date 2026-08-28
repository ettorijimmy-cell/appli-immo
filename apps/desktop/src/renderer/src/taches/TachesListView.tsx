import { useCallback, useEffect, useState } from "react";
import { listTaches, marquerTacheAnnulee, marquerTacheFait, type Tache, type TacheStatut, type TacheType } from "./api";
import { creerCacheLibellesTaches, resoudreLibelleTache } from "./libelle-tache";

const TYPE_LABELS: Record<TacheType, string> = {
  impaye: "Impayé",
  entretien_equipement: "Entretien d'équipement",
  document_expire: "Document expiré",
  quittance_mensuelle: "Quittance mensuelle",
  revision_loyer: "Révision de loyer",
  autre: "Autre"
};

const STATUT_OPTIONS: { value: TacheStatut | ""; label: string }[] = [
  { value: "a_faire", label: "À faire" },
  { value: "en_cours", label: "En cours" },
  { value: "fait", label: "Fait" },
  { value: "annulee", label: "Annulée" },
  { value: "", label: "Tous les statuts" }
];

// Vue minimale pour l'Étape 1 du Module Tâches (docs/backlog.md) : les
// tâches de cette étape sont toutes générées par TachesJobService, aucun
// formulaire de création manuelle ici (pas de create() exposé côté
// backend). Montée sur le Tableau de bord, juste après AlertesListView —
// même emplacement logique (l'action qui découle du constat), et
// docs/app-spec.md section 3bis interdit d'ajouter une 7e entrée à la
// navigation principale sans fusionner deux entrées existantes.
export function TachesListView(): React.JSX.Element {
  const [taches, setTaches] = useState<Tache[]>([]);
  const [libelles, setLibelles] = useState<Map<string, string>>(new Map());
  const [statut, setStatut] = useState<TacheStatut | "">("a_faire");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const filtres = statut ? { statut } : {};
      const lignes = await listTaches(filtres);
      setTaches(lignes);
      setError(null);

      const cache = creerCacheLibellesTaches();
      const entrees = await Promise.all(
        lignes.map(async (tache) => [tache.id, await resoudreLibelleTache(tache, cache)] as const)
      );
      setLibelles(new Map(entrees));
    } catch {
      setError("Impossible de charger les tâches");
    } finally {
      setIsLoading(false);
    }
  }, [statut]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleMarquerFait(id: string): Promise<void> {
    await marquerTacheFait(id);
    await refresh();
  }

  async function handleMarquerAnnulee(id: string): Promise<void> {
    await marquerTacheAnnulee(id);
    await refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Tâches</h2>
        <select
          value={statut}
          onChange={(e) => setStatut(e.target.value as TacheStatut | "")}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {STATUT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : taches.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune tâche.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {taches.map((tache) => (
            <li key={tache.id} className="flex items-center justify-between py-2">
              <div>
                <span className="mr-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                  {TYPE_LABELS[tache.type]}
                </span>
                {libelles.get(tache.id) ?? "…"}
                {tache.dateEcheance && (
                  <span className="ml-2 text-xs text-slate-400">échéance {tache.dateEcheance}</span>
                )}
              </div>
              {(tache.statut === "a_faire" || tache.statut === "en_cours") && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      void handleMarquerFait(tache.id);
                    }}
                    className="text-sm text-indigo-700 hover:text-indigo-800"
                  >
                    Marquer fait
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleMarquerAnnulee(tache.id);
                    }}
                    className="text-sm text-slate-500 hover:text-slate-700"
                  >
                    Marquer annulée
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
