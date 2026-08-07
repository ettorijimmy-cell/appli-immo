import { useRef, useState } from "react";
import type { Appartement } from "../api/patrimoine";
import {
  submitCles,
  submitCompteurs,
  submitEquipementsDivers,
  submitInventaire,
  submitPieceAutre,
  submitPieceChambre,
  submitPieceCuisine,
  submitPieceEntree,
  submitPieceSalleDeBain,
  submitPieceSejour,
  submitPieceWc,
  updateEtatDesLieuxHeader,
  type ElementInventaireMeuble,
  type EtatDesLieuxComplet
} from "../api/etats-des-lieux";
import { ApiError } from "../lib/authenticated-fetch";
import { ClesStepScreen } from "./ClesStepScreen";
import { CompteursStepScreen } from "./CompteursStepScreen";
import type { EtapeHandle } from "./etape-handle";
import { EquipementsDiversStepScreen } from "./EquipementsDiversStepScreen";
import { InventaireStepScreen } from "./InventaireStepScreen";
import { PhotoButton } from "./PhotoButton";
import {
  ELEMENTS_AUTRE,
  ELEMENTS_CHAMBRE,
  ELEMENTS_CUISINE,
  ELEMENTS_ENTREE,
  ELEMENTS_SALLE_DE_BAIN,
  ELEMENTS_SEJOUR,
  ELEMENTS_WC
} from "./pieces-config";
import { PieceStepScreen } from "./PieceStepScreen";
import { RecapStepScreen } from "./RecapStepScreen";
import { construireEtapes, pieceTypePourEtape, type Etape } from "./stepper-config";

// Le vrai outil de capture (parcours pas-à-pas, décisions actées) :
// - une étape à la fois, jamais un long formulaire qui scrolle
// - indicateur de progression global ("Entrée 1/N")
// - résilience réseau : soumission indépendante à chaque "Suivant",
//   bloque avec "Réessayer" en cas d'échec, jamais d'avancée silencieuse
//   sur un état non confirmé enregistré côté serveur
export function EtatDesLieuxStepper({
  etatDesLieux,
  appartement,
  typeBail,
  catalogue,
  onSubmitted,
  onTermine
}: {
  etatDesLieux: EtatDesLieuxComplet;
  appartement: Appartement;
  typeBail: "vide" | "meuble";
  catalogue: ElementInventaireMeuble[];
  onSubmitted: () => Promise<EtatDesLieuxComplet | null>;
  onTermine: () => void;
}): React.JSX.Element {
  const etapes = construireEtapes(appartement, typeBail);
  const mode: "entree" | "sortie" = etatDesLieux.statut === "entree_terminee" ? "sortie" : "entree";
  const [index, setIndex] = useState(0);
  const [donnees, setDonnees] = useState(etatDesLieux);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<EtapeHandle>(null);

  const etape = etapes[index];
  if (!etape) {
    return <p className="p-4 text-sm text-red-600">Erreur : étape introuvable.</p>;
  }

  async function handleSuivant(): Promise<void> {
    setError(null);
    setIsSubmitting(true);
    try {
      await handleRef.current?.submit();
      const fraiches = await onSubmitted();
      if (fraiches) {
        setDonnees(fraiches);
      }
      if (index === etapes.length - 1) {
        onTermine();
        return;
      }
      setIndex((i) => i + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Envoi impossible — vérifiez votre connexion");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePrecedent(): void {
    setError(null);
    setIndex((i) => Math.max(0, i - 1));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {etape.titre} {index + 1}/{etapes.length}
        </p>
        <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
          <div
            className="h-1.5 rounded-full bg-indigo-700 transition-all"
            style={{ width: `${((index + 1) / etapes.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {pieceTypePourEtape(etape) && (
          <div className="mb-4">
            <PhotoButton
              etatDesLieuxId={donnees.id}
              pieceType={pieceTypePourEtape(etape)!}
              {...(etape.numero !== undefined && { pieceNumero: etape.numero })}
            />
          </div>
        )}

        {renderEtape(etape, donnees, mode, catalogue, handleRef)}

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex gap-3 border-t border-slate-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={handlePrecedent}
          disabled={index === 0 || isSubmitting}
          className="flex-1 rounded-md border border-slate-300 py-3 text-base font-medium text-slate-700 disabled:opacity-40"
        >
          Précédent
        </button>
        <button
          type="button"
          onClick={() => void handleSuivant()}
          disabled={isSubmitting}
          className="flex-1 rounded-md bg-indigo-700 py-3 text-base font-medium text-white disabled:opacity-50"
        >
          {isSubmitting ? "Envoi…" : error ? "Réessayer" : index === etapes.length - 1 ? "Terminer" : "Suivant"}
        </button>
      </div>
    </div>
  );
}

function renderEtape(
  etape: Etape,
  donnees: EtatDesLieuxComplet,
  mode: "entree" | "sortie",
  catalogue: ElementInventaireMeuble[],
  ref: React.RefObject<EtapeHandle>
): React.JSX.Element {
  const key = `${etape.type}-${etape.numero ?? ""}`;

  switch (etape.type) {
    case "piece-entree":
      return (
        <PieceStepScreen
          key={key}
          ref={ref}
          elements={ELEMENTS_ENTREE}
          row={donnees.entree}
          mode={mode}
          onSubmit={(payload) => submitPieceEntree(donnees.id, payload).then(() => undefined)}
        />
      );
    case "piece-sejour":
      return (
        <PieceStepScreen
          key={key}
          ref={ref}
          elements={ELEMENTS_SEJOUR}
          row={donnees.sejour}
          mode={mode}
          onSubmit={(payload) => submitPieceSejour(donnees.id, payload).then(() => undefined)}
        />
      );
    case "piece-cuisine":
      return (
        <PieceStepScreen
          key={key}
          ref={ref}
          elements={ELEMENTS_CUISINE}
          row={donnees.cuisine}
          mode={mode}
          onSubmit={(payload) => submitPieceCuisine(donnees.id, payload).then(() => undefined)}
        />
      );
    case "piece-chambre": {
      const row = donnees.chambres.find((r) => r.numero === etape.numero) ?? null;
      return (
        <PieceStepScreen
          key={key}
          ref={ref}
          elements={ELEMENTS_CHAMBRE}
          row={row}
          mode={mode}
          onSubmit={(payload) =>
            submitPieceChambre(donnees.id, { numero: etape.numero, ...payload }).then(() => undefined)
          }
        />
      );
    }
    case "piece-salle-de-bain": {
      const row = donnees.sallesDeBain.find((r) => r.numero === etape.numero) ?? null;
      return (
        <PieceStepScreen
          key={key}
          ref={ref}
          elements={ELEMENTS_SALLE_DE_BAIN}
          row={row}
          mode={mode}
          onSubmit={(payload) =>
            submitPieceSalleDeBain(donnees.id, { numero: etape.numero, ...payload }).then(() => undefined)
          }
        />
      );
    }
    case "piece-wc": {
      const row = donnees.wc.find((r) => r.numero === etape.numero) ?? null;
      return (
        <PieceStepScreen
          key={key}
          ref={ref}
          elements={ELEMENTS_WC}
          row={row}
          mode={mode}
          onSubmit={(payload) => submitPieceWc(donnees.id, { numero: etape.numero, ...payload }).then(() => undefined)}
        />
      );
    }
    case "piece-autre": {
      const row = donnees.autres.find((r) => r.numero === etape.numero) ?? null;
      return (
        <PieceStepScreen
          key={key}
          ref={ref}
          elements={ELEMENTS_AUTRE}
          row={row}
          mode={mode}
          libelleFixe={etape.titre}
          onSubmit={(payload) =>
            submitPieceAutre(donnees.id, { numero: etape.numero, ...payload }).then(() => undefined)
          }
        />
      );
    }
    case "compteurs":
      return (
        <CompteursStepScreen
          key={key}
          ref={ref}
          compteurs={donnees.compteurs}
          mode={mode}
          onSubmit={(payload) => submitCompteurs(donnees.id, payload).then(() => undefined)}
        />
      );
    case "cles":
      return (
        <ClesStepScreen
          key={key}
          ref={ref}
          lignes={donnees.cles}
          mode={mode}
          onSubmit={(lignes) => submitCles(donnees.id, lignes).then(() => undefined)}
        />
      );
    case "equipements-divers":
      return (
        <EquipementsDiversStepScreen
          key={key}
          ref={ref}
          lignes={donnees.equipementsDivers}
          mode={mode}
          onSubmit={(lignes) => submitEquipementsDivers(donnees.id, lignes).then(() => undefined)}
        />
      );
    case "inventaire":
      return (
        <InventaireStepScreen
          key={key}
          ref={ref}
          catalogue={catalogue}
          lignes={donnees.inventaire}
          mode={mode}
          onSubmit={(lignes) => submitInventaire(donnees.id, lignes).then(() => undefined)}
        />
      );
    case "recap":
      return (
        <RecapStepScreen
          key={key}
          ref={ref}
          mode={mode}
          onSubmit={() =>
            updateEtatDesLieuxHeader(donnees.id, {
              [mode === "entree" ? "dateEntree" : "dateSortie"]: new Date().toISOString().slice(0, 10)
            }).then(() => undefined)
          }
        />
      );
  }
}
