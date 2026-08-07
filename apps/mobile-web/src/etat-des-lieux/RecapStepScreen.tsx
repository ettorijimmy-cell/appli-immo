import { forwardRef, useImperativeHandle } from "react";
import type { EtapeHandle } from "./etape-handle";

// Dernière étape : pose date_entree (mode entrée) ou date_sortie (mode
// sortie) — c'est ce qui fait passer etats_des_lieux.statut de
// non_commence à entree_terminee, ou de entree_terminee à complet
// (calculerStatutEtatDesLieux, packages/core). Aucune saisie ici, juste
// la confirmation via le même bouton "Suivant"/"Terminer" que le reste
// du parcours — résilience réseau identique aux autres étapes.
export const RecapStepScreen = forwardRef<
  EtapeHandle,
  {
    mode: "entree" | "sortie";
    onSubmit: () => Promise<void>;
  }
>(function RecapStepScreen({ mode, onSubmit }, ref) {
  useImperativeHandle(ref, () => ({ submit: onSubmit }));

  return (
    <div className="space-y-3 text-center">
      <p className="text-lg font-semibold text-slate-800">
        {mode === "entree" ? "Fin de la visite d'entrée" : "Fin de la visite de sortie"}
      </p>
      <p className="text-sm text-slate-500">
        Appuyez sur « Terminer » pour enregistrer la date d'aujourd'hui comme date{" "}
        {mode === "entree" ? "d'entrée" : "de sortie"}.
      </p>
    </div>
  );
});
