import { useState } from "react";
import { executerJobSyncMessagerie } from "./api";

// Outil de diagnostic manuel, même principe qu'ExecuterJobDiagnostic
// (alertes) — la synchronisation IMAP tourne déjà seule toutes les 10
// minutes (ImapSyncJobService). Ce bouton force une vérification
// immédiate sans attendre le prochain passage.
export function ExecuterJobSyncDiagnostic(): React.JSX.Element {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [derniereExecution, setDerniereExecution] = useState<number | null>(null);

  async function handleExecuterJob(): Promise<void> {
    setIsRunning(true);
    setError(null);
    try {
      const nombreImportes = await executerJobSyncMessagerie();
      setDerniereExecution(nombreImportes);
    } catch {
      setError("Impossible d'exécuter la synchronisation");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-slate-700">Diagnostic — synchronisation de la messagerie</h2>
      <p className="text-sm text-slate-500">
        La boîte mail dédiée est synchronisée automatiquement toutes les 10 minutes. Ce bouton force une
        vérification immédiate — il ne remplace pas le job planifié.
      </p>
      <button
        type="button"
        onClick={() => {
          void handleExecuterJob();
        }}
        disabled={isRunning}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {isRunning ? "Synchronisation…" : "Synchroniser maintenant"}
      </button>
      {derniereExecution !== null && (
        <p className="text-sm text-slate-500">
          Synchronisé — {derniereExecution} nouveau{derniereExecution > 1 ? "x" : ""} message
          {derniereExecution > 1 ? "s" : ""} importé{derniereExecution > 1 ? "s" : ""}.
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
