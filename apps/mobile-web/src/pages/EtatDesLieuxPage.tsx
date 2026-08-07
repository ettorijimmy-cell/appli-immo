import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getAppartement, getBail, type Appartement, type Bail } from "../api/patrimoine";
import {
  createEtatDesLieux,
  getCatalogueInventaire,
  getEtatDesLieuxParBail,
  type ElementInventaireMeuble,
  type EtatDesLieuxComplet
} from "../api/etats-des-lieux";
import { EtatDesLieuxStepper } from "../etat-des-lieux/EtatDesLieuxStepper";
import { ApiError } from "../lib/authenticated-fetch";

// Résout bail + appartement + état des lieux existant (ou propose sa
// création, bloquée côté backend si la composition de l'appartement est
// incomplète — validerCompletudeEtatDesLieux) avant de lancer le
// parcours pas-à-pas.
export function EtatDesLieuxPage(): React.JSX.Element {
  const { bailId } = useParams<{ bailId: string }>();
  const navigate = useNavigate();

  const [bail, setBail] = useState<Bail | null>(null);
  const [appartement, setAppartement] = useState<Appartement | null>(null);
  const [etatDesLieux, setEtatDesLieux] = useState<EtatDesLieuxComplet | null>(null);
  const [catalogue, setCatalogue] = useState<ElementInventaireMeuble[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [termine, setTermine] = useState(false);

  const charger = useCallback(async () => {
    if (!bailId) {
      return null;
    }
    const bailData = await getBail(bailId);
    const appartementData = await getAppartement(bailData.appartementId);
    const edl = await getEtatDesLieuxParBail(bailId);
    setBail(bailData);
    setAppartement(appartementData);
    setEtatDesLieux(edl);
    if (edl && bailData.typeBail === "meuble") {
      setCatalogue(await getCatalogueInventaire());
    }
    return edl;
  }, [bailId]);

  useEffect(() => {
    setIsLoading(true);
    charger()
      .catch(() => setError("Impossible de charger l'état des lieux"))
      .finally(() => setIsLoading(false));
  }, [charger]);

  async function handleCreer(): Promise<void> {
    if (!bailId) {
      return;
    }
    setError(null);
    setIsCreating(true);
    try {
      await createEtatDesLieux(bailId);
      await charger();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer l'état des lieux");
    } finally {
      setIsCreating(false);
    }
  }

  if (isLoading) {
    return <p className="p-4 text-sm text-slate-500">Chargement…</p>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md p-4">
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="mt-4 text-sm text-indigo-700 underline underline-offset-2"
        >
          Retour à la liste
        </button>
      </div>
    );
  }

  if (!bail || !appartement) {
    return <p className="p-4 text-sm text-red-600">Bail introuvable.</p>;
  }

  if (!etatDesLieux) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-4 text-center">
        <p className="text-base text-slate-700">Aucun état des lieux pour ce bail.</p>
        <button
          type="button"
          onClick={() => void handleCreer()}
          disabled={isCreating}
          className="w-full rounded-md bg-indigo-700 py-3 text-base font-medium text-white disabled:opacity-50"
        >
          {isCreating ? "Création…" : "Démarrer l'état des lieux"}
        </button>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="text-sm text-slate-500 underline underline-offset-2"
        >
          Retour à la liste
        </button>
      </div>
    );
  }

  if (etatDesLieux.statut === "complet" || termine) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-4 text-center">
        <p className="text-base text-slate-700">
          {termine ? "Visite enregistrée." : "Cet état des lieux est déjà complet (entrée et sortie renseignées)."}
        </p>
        <p className="text-sm text-slate-500">
          Les corrections se font depuis l'application desktop, vue de relecture.
        </p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="w-full rounded-md bg-indigo-700 py-3 text-base font-medium text-white"
        >
          Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <EtatDesLieuxStepper
      etatDesLieux={etatDesLieux}
      appartement={appartement}
      typeBail={bail.typeBail}
      catalogue={catalogue}
      onSubmitted={charger}
      onTermine={() => setTermine(true)}
    />
  );
}
