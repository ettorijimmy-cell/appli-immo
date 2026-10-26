import { forwardRef, useImperativeHandle } from "react";
import type { EtapeHandle } from "./etape-handle";

// Dernière étape avant la signature : purement informative (aucune
// soumission réseau) — la date d'entrée/sortie n'est plus posée ici
// depuis le chantier Signatures : c'est désormais SignatureStepScreen
// (signer-entree/signer-sortie) qui la pose, dans la même transaction que
// les signatures. `submit` résout immédiatement pour rester compatible
// avec le contrat EtapeHandle commun à toutes les étapes.
export const RecapStepScreen = forwardRef<
  EtapeHandle,
  {
    mode: "entree" | "sortie";
  }
>(function RecapStepScreen({ mode }, ref) {
  useImperativeHandle(ref, () => ({ submit: () => Promise.resolve() }));

  return (
    <div className="space-y-3 text-center">
      <p className="text-lg font-semibold text-slate-800">
        {mode === "entree" ? "Fin de la visite d'entrée" : "Fin de la visite de sortie"}
      </p>
      <p className="text-sm text-slate-500">
        Appuyez sur « Suivant » pour passer à la signature.
      </p>
    </div>
  );
});
