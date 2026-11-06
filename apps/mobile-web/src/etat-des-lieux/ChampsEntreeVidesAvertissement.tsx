import { champsEntreeVides } from "core";
import type { EtatDesLieuxComplet } from "../api/etats-des-lieux";
import type { Appartement } from "../api/patrimoine";

// Avant la signature numérique de l'entrée : rappel NON bloquant des champs
// d'entrée encore vides (même calcul que le desktop avant une déclaration
// papier, champsEntreeVides dans "core"). Rien n'empêche de signer.
export function ChampsEntreeVidesAvertissement({
  donnees,
  appartement
}: {
  donnees: EtatDesLieuxComplet;
  appartement: Appartement;
}): React.JSX.Element | null {
  const zones = champsEntreeVides({
    composition: {
      nombreChambres: appartement.nombreChambres,
      nombreSallesDeBain: appartement.nombreSallesDeBain,
      nombreWc: appartement.nombreWc,
      autresPieces: [appartement.autrePiece1, appartement.autrePiece2].filter((p): p is string => Boolean(p))
    },
    entree: donnees.entree,
    sejour: donnees.sejour,
    cuisine: donnees.cuisine,
    chambres: donnees.chambres,
    sallesDeBain: donnees.sallesDeBain,
    wc: donnees.wc,
    autres: donnees.autres,
    cles: donnees.cles,
    equipementsDivers: donnees.equipementsDivers,
    inventaire: donnees.inventaire
  });
  if (zones.length === 0) {
    return null;
  }
  return (
    <div role="status" className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">Champs d'entrée encore vides</p>
      <p className="text-xs">Vous pouvez signer quand même ; revenez en arrière pour les compléter.</p>
      <ul className="mt-1 list-inside list-disc text-xs">
        {zones.map((z) => (
          <li key={z.zone}>
            {z.zone} : {z.manquants.join(", ")}
          </li>
        ))}
      </ul>
    </div>
  );
}
