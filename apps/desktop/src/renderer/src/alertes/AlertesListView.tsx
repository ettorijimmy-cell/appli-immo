import { useCallback, useEffect, useState } from "react";
import { executerJobAlertes, ignorerAlerte, listAlertes, traiterAlerte, type Alerte, type AlerteType } from "./api";

const LABELS: Record<AlerteType, string> = {
  bail_fin_proche: "Fin de bail proche",
  document_expire: "Document expiré",
  document_expire_proche: "Document bientôt expiré",
  entretien_equipement: "Entretien d'équipement",
  impaye: "Impayé"
};

// Vue minimale pour ce module (docs/backlog.md, Module 6 : "action traiter
// une alerte"). Une vraie présentation (tri, regroupement, accès rapides)
// arrive avec le Module 7 — Tableau de bord.
//
// Le bouton "Exécuter le job maintenant" N'EST PAS une conception Module 7 :
// posé uniquement pour satisfaire le critère de complétion du Module 6 et
// permettre une vérification manuelle sans attendre le cron quotidien
// (1h du matin, voir AlertesJobService). À trancher explicitement à
// l'ouverture du Module 7 (docs/backlog.md, section correspondante) — le
// garder, le déplacer dans Paramètres/Diagnostics, ou le retirer au profit
// du seul cron — pour ne pas laisser deux façons différentes d'interagir
// avec les alertes dans l'app.
export function AlertesListView(): React.JSX.Element {
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setAlertes(await listAlertes({ statut: "active" }));
      setError(null);
    } catch {
      setError("Impossible de charger les alertes");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleTraiter(id: string): Promise<void> {
    await traiterAlerte(id);
    await refresh();
  }

  async function handleIgnorer(id: string): Promise<void> {
    await ignorerAlerte(id);
    await refresh();
  }

  async function handleExecuterJob(): Promise<void> {
    setIsRunning(true);
    try {
      await executerJobAlertes();
      await refresh();
    } catch {
      setError("Impossible d'exécuter le job");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Alertes actives</h2>
        <button
          type="button"
          onClick={() => {
            void handleExecuterJob();
          }}
          disabled={isRunning}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {isRunning ? "Exécution…" : "Exécuter le job maintenant"}
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : alertes.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune alerte active.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {alertes.map((alerte) => (
            <li key={alerte.id} className="flex items-center justify-between py-2">
              <div>
                <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                  {LABELS[alerte.type]}
                </span>
                {alerte.message}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void handleTraiter(alerte.id);
                  }}
                  className="text-sm text-indigo-700 hover:text-indigo-800"
                >
                  Traiter
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleIgnorer(alerte.id);
                  }}
                  className="text-sm text-slate-500 hover:text-slate-700"
                >
                  Ignorer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
