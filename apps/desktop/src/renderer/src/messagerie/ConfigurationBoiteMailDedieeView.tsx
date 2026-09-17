import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../lib/authenticated-fetch";
import { configurerBoiteMailDediee, obtenirStatutBoiteMailDediee, type StatutBoiteMailDediee } from "./api";

// Section Paramètres — Module Messagerie (2026-09-16). IMAP (lecture) +
// SMTP (envoi) authentifiés par un mot de passe d'application Gmail (16
// caractères, nécessite la validation en 2 étapes activée sur le compte),
// jamais l'API Gmail OAuth pour ce module (voir docs/data-dictionary.md,
// section boite_mail_dediee, pour la décision technique complète). Le mot
// de passe n'est jamais renvoyé par le backend une fois enregistré — le
// formulaire de reconfiguration repart toujours d'un champ vide, jamais
// pré-rempli avec une valeur déchiffrée.
export function ConfigurationBoiteMailDedieeView(): React.JSX.Element {
  const [statut, setStatut] = useState<StatutBoiteMailDediee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modeEdition, setModeEdition] = useState(false);
  const [email, setEmail] = useState("");
  const [motDePasseApp, setMotDePasseApp] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setStatut(await obtenirStatutBoiteMailDediee());
      setError(null);
    } catch {
      setError("Impossible de charger le statut de la boîte mail dédiée");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleEnregistrer(e: FormEvent): Promise<void> {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const nouveauStatut = await configurerBoiteMailDediee({ email, motDePasseApp });
      setStatut(nouveauStatut);
      setModeEdition(false);
      setEmail("");
      setMotDePasseApp("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer la boîte mail dédiée");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-slate-700">Boîte mail dédiée</h2>
      <p className="text-xs text-slate-500">
        Boîte Gmail séparée de votre compte personnel, utilisée uniquement pour la gestion locative — lecture (IMAP)
        et envoi (SMTP) via un mot de passe d'application, jamais via l'API Gmail. Les envois automatiques de Tâches
        (quittances, relances) passent par cette boîte.
      </p>
      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : !modeEdition ? (
        <div className="flex items-center gap-3">
          {statut?.configuree ? (
            <span className="text-sm text-slate-700">Configurée — {statut.email}</span>
          ) : (
            <span className="text-sm text-slate-500">Non configurée</span>
          )}
          <button
            type="button"
            onClick={() => setModeEdition(true)}
            className="text-sm text-indigo-700 hover:text-indigo-800"
          >
            {statut?.configuree ? "Reconfigurer" : "Configurer"}
          </button>
        </div>
      ) : (
        <form onSubmit={handleEnregistrer} className="max-w-md space-y-2">
          <label className="block text-sm">
            Adresse email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            Mot de passe d'application (16 caractères)
            <input
              type="password"
              required
              value={motDePasseApp}
              onChange={(e) => setMotDePasseApp(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <p className="text-xs text-slate-500">
            Généré depuis myaccount.google.com/apppasswords (nécessite la validation en 2 étapes activée sur ce
            compte) — jamais votre mot de passe Google habituel.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {isSaving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button
              type="button"
              onClick={() => {
                setModeEdition(false);
                setEmail("");
                setMotDePasseApp("");
              }}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Annuler
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
