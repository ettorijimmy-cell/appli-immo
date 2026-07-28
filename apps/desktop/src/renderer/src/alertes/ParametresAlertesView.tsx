import { useCallback, useEffect, useState } from "react";
import { listParametresAlertes, updateParametreAlerte, type AlerteType, type ParametreAlerte } from "./api";

const LABELS: Record<AlerteType, string> = {
  bail_fin_proche: "Fin de bail proche",
  document_expire: "Document expiré",
  document_expire_proche: "Document bientôt expiré",
  entretien_equipement: "Entretien d'équipement",
  impaye: "Impayé"
};

export function ParametresAlertesView(): React.JSX.Element {
  const [parametres, setParametres] = useState<ParametreAlerte[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingType, setSavingType] = useState<AlerteType | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setParametres(await listParametresAlertes());
      setError(null);
    } catch {
      setError("Impossible de charger les seuils d'alertes");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleChange(type: AlerteType, valeur: string): Promise<void> {
    const seuil = Number(valeur);
    if (!Number.isInteger(seuil) || seuil < 0) {
      return;
    }
    setSavingType(type);
    try {
      await updateParametreAlerte(type, seuil);
      await refresh();
    } finally {
      setSavingType(null);
    }
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

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">Seuils des alertes</h2>
      <p className="text-xs text-slate-500">
        Nombre de jours avant l'échéance (délai de grâce après l'échéance pour "Impayé").
        "Document expiré" n'a pas de seuil : un document est expiré ou ne l'est pas.
      </p>
      <table className="w-full max-w-md text-left text-sm">
        <tbody>
          {parametres.map((parametre) => (
            <tr key={parametre.type} className="border-b border-slate-100">
              <td className="py-2">{LABELS[parametre.type]}</td>
              <td className="py-2 text-right">
                <input
                  type="number"
                  min={0}
                  defaultValue={parametre.seuilJoursAvant}
                  disabled={savingType === parametre.type}
                  onBlur={(event) => {
                    void handleChange(parametre.type, event.target.value);
                  }}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
                />{" "}
                jours
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
