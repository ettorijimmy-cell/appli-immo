import { useState } from "react";
import { executerJobTaches } from "./api";

// Même principe que ExecuterJobDiagnostic (alertes) : le job Tâches tourne
// déjà seul chaque jour à 4h du matin (TachesJobService), de façon
// idempotente — après le job Alertes (1h). Ce bouton force une vérification
// immédiate sans attendre le prochain cron, pas un usage courant.
export function ExecuterJobTachesDiagnostic(): React.JSX.Element {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [derniereExecution, setDerniereExecution] = useState<number | null>(null);

  async function handleExecuterJob(): Promise<void> {
    setIsRunning(true);
    setError(null);
    try {
      const taches = await executerJobTaches();
      setDerniereExecution(taches.length);
    } catch {
      setError("Impossible d'exécuter le job");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-slate-700">Diagnostic — génération des tâches</h2>
      <p className="text-sm text-slate-500">
        Le job Tâches tourne automatiquement chaque jour à 4h du matin, après le job Alertes. Ce
        bouton force une vérification immédiate — il ne remplace pas le cron et n'a pas besoin
        d'être utilisé en usage courant.
      </p>
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
      {derniereExecution !== null && (
        <p className="text-sm text-slate-500">
          Exécuté — {derniereExecution} tâche{derniereExecution > 1 ? "s" : ""} au total (tous
          statuts) après ce passage.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
