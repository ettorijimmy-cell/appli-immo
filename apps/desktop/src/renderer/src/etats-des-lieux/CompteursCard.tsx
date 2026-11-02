import { CLASSIFICATION_COMPTEURS, champModifiable } from "core";
import { useState } from "react";
import type { Compteurs } from "./api";

type ChampsCompteurs = Record<
  | "electriciteNumeroCompteurEntree"
  | "electriciteNumeroCompteurSortie"
  | "electriciteReleveHpEntree"
  | "electriciteReleveHpSortie"
  | "electriciteReleveHcEntree"
  | "electriciteReleveHcSortie"
  | "electriciteAncienOccupantEntree"
  | "electriciteAncienOccupantSortie"
  | "gazNumeroCompteurEntree"
  | "gazNumeroCompteurSortie"
  | "gazReleveEntree"
  | "gazReleveSortie"
  | "eauReleveFroideEntree"
  | "eauReleveFroideSortie"
  | "eauReleveChaudeEntree"
  | "eauReleveChaudeSortie",
  string
>;

function valeursInitiales(compteurs: Compteurs | null): ChampsCompteurs {
  return {
    electriciteNumeroCompteurEntree: compteurs?.electriciteNumeroCompteurEntree ?? "",
    electriciteNumeroCompteurSortie: compteurs?.electriciteNumeroCompteurSortie ?? "",
    electriciteReleveHpEntree: compteurs?.electriciteReleveHpEntree ?? "",
    electriciteReleveHpSortie: compteurs?.electriciteReleveHpSortie ?? "",
    electriciteReleveHcEntree: compteurs?.electriciteReleveHcEntree ?? "",
    electriciteReleveHcSortie: compteurs?.electriciteReleveHcSortie ?? "",
    electriciteAncienOccupantEntree: compteurs?.electriciteAncienOccupantEntree ?? "",
    electriciteAncienOccupantSortie: compteurs?.electriciteAncienOccupantSortie ?? "",
    gazNumeroCompteurEntree: compteurs?.gazNumeroCompteurEntree ?? "",
    gazNumeroCompteurSortie: compteurs?.gazNumeroCompteurSortie ?? "",
    gazReleveEntree: compteurs?.gazReleveEntree ?? "",
    gazReleveSortie: compteurs?.gazReleveSortie ?? "",
    eauReleveFroideEntree: compteurs?.eauReleveFroideEntree ?? "",
    eauReleveFroideSortie: compteurs?.eauReleveFroideSortie ?? "",
    eauReleveChaudeEntree: compteurs?.eauReleveChaudeEntree ?? "",
    eauReleveChaudeSortie: compteurs?.eauReleveChaudeSortie ?? ""
  };
}

// Section dédiée (pas de grille générique ici, contrairement aux pièces)
// : électricité/gaz/eau n'ont pas la même forme (relève HP/HC/ancien
// occupant pour l'électricité, un seul relevé pour le gaz, deux pour
// l'eau froide/chaude, jamais de numéro de compteur pour l'eau).
export function CompteursCard({
  compteurs,
  entreeSignee,
  sortieSignee,
  onSave
}: {
  compteurs: Compteurs | null;
  entreeSignee: boolean;
  sortieSignee: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}): React.JSX.Element {
  const [valeurs, setValeurs] = useState<ChampsCompteurs>(() => valeursInitiales(compteurs));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setChamp(cle: keyof ChampsCompteurs, valeur: string): void {
    setValeurs((v) => ({ ...v, [cle]: valeur }));
  }

  // Même règle que le verrou d'écriture backend : les relevés d'entrée se
  // figent à la signature d'entrée, ceux de sortie à la signature de sortie.
  function champEditable(cle: keyof ChampsCompteurs): boolean {
    return champModifiable({
      nomChamp: cle,
      classification: CLASSIFICATION_COMPTEURS,
      ligneExistante: compteurs !== null,
      entreeSignee,
      sortieSignee
    });
  }

  function champ(cle: keyof ChampsCompteurs, label: string): React.JSX.Element {
    const editable = champEditable(cle);
    return (
      <div className="space-y-0.5">
        <label htmlFor={`compteur-${cle}`} className="text-xs text-slate-500">
          {label}
        </label>
        <input
          id={`compteur-${cle}`}
          value={valeurs[cle]}
          onChange={(e) => setChamp(cle, e.target.value)}
          readOnly={!editable}
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm read-only:bg-slate-50 read-only:text-slate-500"
        />
      </div>
    );
  }

  async function handleSave(): Promise<void> {
    setError(null);
    setIsSaving(true);
    try {
      // Un champ figé n'est jamais envoyé, comme sur les pièces.
      const soumises: Partial<ChampsCompteurs> = Object.fromEntries(
        Object.entries(valeurs).filter(([cle]) => champEditable(cle as keyof ChampsCompteurs))
      );
      await onSave({
        electricite: {
          ...(soumises.electriciteNumeroCompteurEntree && {
            numeroCompteurEntree: soumises.electriciteNumeroCompteurEntree
          }),
          ...(soumises.electriciteNumeroCompteurSortie && {
            numeroCompteurSortie: soumises.electriciteNumeroCompteurSortie
          }),
          ...(soumises.electriciteReleveHpEntree && { releveHpEntree: soumises.electriciteReleveHpEntree }),
          ...(soumises.electriciteReleveHpSortie && { releveHpSortie: soumises.electriciteReleveHpSortie }),
          ...(soumises.electriciteReleveHcEntree && { releveHcEntree: soumises.electriciteReleveHcEntree }),
          ...(soumises.electriciteReleveHcSortie && { releveHcSortie: soumises.electriciteReleveHcSortie }),
          ...(soumises.electriciteAncienOccupantEntree && {
            ancienOccupantEntree: soumises.electriciteAncienOccupantEntree
          }),
          ...(soumises.electriciteAncienOccupantSortie && {
            ancienOccupantSortie: soumises.electriciteAncienOccupantSortie
          })
        },
        gaz: {
          ...(soumises.gazNumeroCompteurEntree && { numeroCompteurEntree: soumises.gazNumeroCompteurEntree }),
          ...(soumises.gazNumeroCompteurSortie && { numeroCompteurSortie: soumises.gazNumeroCompteurSortie }),
          ...(soumises.gazReleveEntree && { releveEntree: soumises.gazReleveEntree }),
          ...(soumises.gazReleveSortie && { releveSortie: soumises.gazReleveSortie })
        },
        eau: {
          ...(soumises.eauReleveFroideEntree && { releveFroideEntree: soumises.eauReleveFroideEntree }),
          ...(soumises.eauReleveFroideSortie && { releveFroideSortie: soumises.eauReleveFroideSortie }),
          ...(soumises.eauReleveChaudeEntree && { releveChaudeEntree: soumises.eauReleveChaudeEntree }),
          ...(soumises.eauReleveChaudeSortie && { releveChaudeSortie: soumises.eauReleveChaudeSortie })
        }
      });
    } catch {
      setError("Impossible d'enregistrer les compteurs");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">Compteurs</h4>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving || sortieSignee}
          className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {isSaving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-x-6 gap-y-3">
        <div className="space-y-2">
          <h5 className="text-xs font-semibold uppercase text-slate-400">Électricité</h5>
          {champ("electriciteNumeroCompteurEntree", "N° compteur (entrée)")}
          {champ("electriciteNumeroCompteurSortie", "N° compteur (sortie)")}
          {champ("electriciteReleveHpEntree", "Relève HP (entrée)")}
          {champ("electriciteReleveHpSortie", "Relève HP (sortie)")}
          {champ("electriciteReleveHcEntree", "Relève HC (entrée)")}
          {champ("electriciteReleveHcSortie", "Relève HC (sortie)")}
          {champ("electriciteAncienOccupantEntree", "Ancien occupant (entrée)")}
          {champ("electriciteAncienOccupantSortie", "Ancien occupant (sortie)")}
        </div>
        <div className="space-y-2">
          <h5 className="text-xs font-semibold uppercase text-slate-400">Gaz</h5>
          {champ("gazNumeroCompteurEntree", "N° compteur (entrée)")}
          {champ("gazNumeroCompteurSortie", "N° compteur (sortie)")}
          {champ("gazReleveEntree", "Relève (entrée)")}
          {champ("gazReleveSortie", "Relève (sortie)")}
        </div>
        <div className="space-y-2">
          <h5 className="text-xs font-semibold uppercase text-slate-400">Eau</h5>
          {champ("eauReleveFroideEntree", "Relève froide (entrée)")}
          {champ("eauReleveFroideSortie", "Relève froide (sortie)")}
          {champ("eauReleveChaudeEntree", "Relève chaude (entrée)")}
          {champ("eauReleveChaudeSortie", "Relève chaude (sortie)")}
        </div>
      </div>
    </div>
  );
}
