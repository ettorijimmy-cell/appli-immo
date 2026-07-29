import { useCallback, useEffect, useState } from "react";
import { ignorerAlerte, listAlertes, traiterAlerte, type Alerte, type AlerteType } from "./api";

const LABELS: Record<AlerteType, string> = {
  bail_fin_proche: "Fin de bail proche",
  document_expire: "Document expiré",
  document_expire_proche: "Document bientôt expiré",
  entretien_equipement: "Entretien d'équipement",
  impaye: "Impayé"
};

// Vue minimale pour ce module (docs/backlog.md, Module 6 : "action traiter
// une alerte"). Montée sur le Tableau de bord (Module 7) : la carte de
// synthèse "Alertes actives" n'affiche qu'un compteur, jamais d'action —
// cette liste reste le seul endroit où traiter/ignorer une alerte.
//
// Le bouton "Exécuter le job maintenant", qui vivait ici, a été déplacé
// dans Paramètres (ParametresPage.tsx, ExecuterJobDiagnostic.tsx) — décision
// tranchée après avoir été laissée en suspens depuis le Module 6 (voir
// docs/backlog.md, Module 6). Un déclenchement manuel du job n'est pas une
// action courante de consultation du tableau de bord.
export function AlertesListView(): React.JSX.Element {
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">Alertes actives</h2>
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
