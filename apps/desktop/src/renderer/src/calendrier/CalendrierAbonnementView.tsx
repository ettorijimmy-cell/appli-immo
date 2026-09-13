import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/api-config";
import { ApiError } from "../lib/authenticated-fetch";
import { obtenirAbonnementCalendrier, regenererJetonCalendrier } from "./abonnement-api";

// Section Paramètres — Module Calendrier d'interventions (2026-09-15).
// L'URL d'abonnement ICS contient un jeton long et aléatoire qui fait
// office de seule barrière de sécurité (le flux est accessible sans JWT,
// une application calendrier ne pouvant pas en fournir un) — jamais une
// vraie authentification, donc à traiter comme un secret malgré tout
// (voir packages/db/src/schema/calendrier-abonnement.ts). Régénérer révoque
// implicitement l'ancienne URL.
export function CalendrierAbonnementView(): React.JSX.Element {
  const [abonnement, setAbonnement] = useState<{ jeton: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setAbonnement(await obtenirAbonnementCalendrier());
      setError(null);
    } catch {
      setError("Impossible de charger l'abonnement au calendrier");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRegenerer(): Promise<void> {
    setIsRegenerating(true);
    setError(null);
    try {
      setAbonnement(await regenererJetonCalendrier());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de générer le jeton d'abonnement");
    } finally {
      setIsRegenerating(false);
    }
  }

  const url = abonnement ? `${API_BASE_URL}/calendrier/ics/${abonnement.jeton}` : null;

  async function copierUrl(): Promise<void> {
    if (!url) {
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopie(true);
    setTimeout(() => setCopie(false), 2000);
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-700">Abonnement calendrier (ICS)</h2>
      <p className="text-xs text-slate-500">
        Ajoutez cette URL comme calendrier "par abonnement" sur votre téléphone pour voir automatiquement vos
        interventions, visites et états des lieux planifiés. Synchronisation à sens unique uniquement (l'application
        ne lit jamais votre calendrier téléphone).
      </p>
      <p className="text-xs font-medium text-amber-700">
        Cette URL contient un jeton secret : quiconque la possède peut lire votre calendrier. Ne la partagez pas, et
        régénérez-la si vous pensez qu'elle a fuité.
      </p>
      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : (
        <div className="space-y-2">
          {url ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={url}
                className="w-full max-w-lg rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-600"
              />
              <button
                type="button"
                onClick={() => {
                  void copierUrl();
                }}
                className="text-sm text-indigo-700 hover:text-indigo-800"
              >
                {copie ? "Copié !" : "Copier"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Aucune URL générée pour le moment.</p>
          )}
          <button
            type="button"
            onClick={() => {
              void handleRegenerer();
            }}
            disabled={isRegenerating}
            className="text-sm text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
          >
            {isRegenerating ? "Génération…" : url ? "Régénérer l'URL" : "Générer une URL"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
