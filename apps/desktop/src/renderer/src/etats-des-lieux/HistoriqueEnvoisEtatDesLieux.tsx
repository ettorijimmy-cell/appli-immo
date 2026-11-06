import { libelleResultatRemise } from "core";
import { useEffect, useState } from "react";
import { getHistoriqueEnvois, type EnvoiHistorique } from "./api";
import { messageErreurCartePdf } from "./message-erreur-carte-pdf";

const LABEL_PHASE: Record<"entree" | "sortie", string> = { entree: "Entrée", sortie: "Sortie" };

// Preuve de remise : chaque tentative, avec l'adresse réellement utilisée,
// même si la fiche du locataire a changé depuis.
export function HistoriqueEnvoisEtatDesLieux({
  etatDesLieuxId,
  version
}: {
  etatDesLieuxId: string;
  version: number;
}): React.JSX.Element | null {
  const [envois, setEnvois] = useState<EnvoiHistorique[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    getHistoriqueEnvois(etatDesLieuxId)
      .then((donnees) => {
        if (!annule) {
          setEnvois(donnees);
          setErreur(null);
        }
      })
      .catch((err: unknown) => {
        if (!annule) {
          setErreur(messageErreurCartePdf(err, "Impossible de récupérer l'historique des envois."));
        }
      });
    return () => {
      annule = true;
    };
  }, [etatDesLieuxId, version]);

  if (erreur) {
    return (
      <p role="alert" className="mt-3 text-xs text-red-600">
        {erreur}
      </p>
    );
  }
  if (envois.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <h5 className="mb-1 text-xs font-semibold text-slate-600">Historique des envois</h5>
      <ul className="space-y-1">
        {envois.map((envoi) => (
          <li key={envoi.id} className="text-xs text-slate-600">
            <span className="font-medium text-slate-700">{LABEL_PHASE[envoi.phase]}</span> — {envoi.nomDestinataire} —{" "}
            {envoi.adresseUtilisee}
            <span className="block text-slate-500">{libelleResultatRemise(envoi)}</span>
            {envoi.scanSha256 && (
              <span className="block text-slate-500">
                Scan de l'entrée papier joint — empreinte SHA-256{" "}
                <span className="font-mono" title={envoi.scanSha256}>
                  {envoi.scanSha256.slice(0, 16)}…
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
