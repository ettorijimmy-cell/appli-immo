import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/authenticated-fetch";
import { obtenirStatutGmail, obtenirUrlConsentementGmail, type StatutGmail } from "./api";

// Section Paramètres — Module Tâches, Étape 3 (intégration Gmail). Le flux
// de consentement s'ouvre dans le navigateur système (window.api.shell.
// openExternal, jamais dans une fenêtre Electron interne) ; aucune
// redirection ne ramène l'utilisateur dans l'app (voir GoogleOAuthController,
// page de confirmation minimale) — d'où le bouton "Rafraîchir" manuel après
// un aller-retour.
export function ConnexionGmailView(): React.JSX.Element {
  const [statut, setStatut] = useState<StatutGmail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setStatut(await obtenirStatutGmail());
      setError(null);
    } catch {
      setError("Impossible de charger le statut de connexion Gmail");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleConnecter(): Promise<void> {
    setIsConnecting(true);
    setError(null);
    try {
      const { url } = await obtenirUrlConsentementGmail();
      await window.api.shell.openExternal(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'ouvrir la page de connexion Gmail");
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-700">Connexion Gmail</h2>
      <p className="text-xs text-slate-500">
        Utilisée pour l'envoi des notifications (quittances, révisions de loyer, alertes) depuis votre propre compte
        Gmail.
      </p>
      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : (
        <div className="flex items-center gap-3">
          {statut?.connecte ? (
            <span className="text-sm text-slate-700">Connecté — {statut.emailCompte}</span>
          ) : (
            <span className="text-sm text-slate-500">Non connecté</span>
          )}
          <button
            type="button"
            onClick={() => {
              void handleConnecter();
            }}
            disabled={isConnecting}
            className="text-sm text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
          >
            {isConnecting ? "Ouverture…" : statut?.connecte ? "Reconnecter" : "Connecter Gmail"}
          </button>
          <button
            type="button"
            onClick={() => {
              void refresh();
            }}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Rafraîchir
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
