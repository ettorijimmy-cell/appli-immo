import { useState } from "react";
import { executerJobAlertes } from "./api";

// Outil de diagnostic manuel, pas une action courante : le job d'alertes
// tourne déjà seul chaque jour à 1h du matin (AlertesJobService), de façon
// idempotente. Ce bouton sert uniquement à forcer une vérification
// immédiate après une correction manuelle (ex. date d'échéance modifiée),
// sans attendre le prochain cron — pas à un usage quotidien.
//
// Vivait auparavant sur le Tableau de bord (Module 6, provisoire) ; déplacé
// ici en tranchant la décision laissée en suspens depuis le Module 6 (voir
// docs/backlog.md, Module 6 puis Module 7).
export function ExecuterJobDiagnostic(): React.JSX.Element {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [derniereExecution, setDerniereExecution] = useState<number | null>(null);

  async function handleExecuterJob(): Promise<void> {
    setIsRunning(true);
    setError(null);
    try {
      const alertes = await executerJobAlertes();
      setDerniereExecution(alertes.length);
    } catch {
      setError("Impossible d'exécuter le job");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-slate-700">Diagnostic — moteur d'alertes</h2>
      <p className="text-sm text-slate-500">
        Le job d'alertes tourne automatiquement chaque jour à 1h du matin. Ce bouton force une
        vérification immédiate (par exemple après une correction manuelle) — il ne remplace pas le
        cron et n'a pas besoin d'être utilisé en usage courant.
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
          Exécuté — {derniereExecution} alerte{derniereExecution > 1 ? "s" : ""} au total (tous statuts)
          après ce passage.
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
