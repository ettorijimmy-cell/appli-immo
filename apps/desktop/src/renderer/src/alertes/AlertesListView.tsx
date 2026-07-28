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
// une alerte"). Une vraie présentation (tri, regroupement, accès rapides)
// arrive avec le Module 7 — Tableau de bord.
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

  if (isLoading) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }
  if (alertes.length === 0) {
    return <p className="text-sm text-slate-500">Aucune alerte active.</p>;
  }

  return (
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
  );
}
