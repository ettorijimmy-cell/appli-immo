import { formaterDateCourteFr } from "core";
import type { SignaturePosee } from "./api";

export interface Figement {
  phase: "entree" | "sortie";
  texte: string;
}

// La phase se fige à la dernière signature posée, pas à la première.
export function dateSignaturePhase(signatures: SignaturePosee[], phase: "entree" | "sortie"): string | null {
  const instants = signatures.filter((s) => s.phase === phase).map((s) => Date.parse(s.signeLe));
  return instants.length > 0 ? new Date(Math.max(...instants)).toLocaleDateString("fr-FR") : null;
}

// Une carte a toujours des champs de sortie : elle n'est entièrement figée
// qu'à la signature de sortie. Entre les deux signatures, seuls les champs
// d'entrée et les champs communs le sont, d'où la précision du libellé.
// Entrée établie sur papier (2026-11-06) : la date est celle portée sur le
// papier, pas celle d'une signature numérique (il n'y en a pas).
export function figementCarte(
  entreeSignee: boolean,
  sortieSignee: boolean,
  signatures: SignaturePosee[],
  entreePapier: { dateSignature: string } | null = null
): Figement | null {
  if (sortieSignee) {
    const date = dateSignaturePhase(signatures, "sortie");
    return { phase: "sortie", texte: `Figé par la signature de sortie${date ? ` du ${date}` : ""}` };
  }
  if (entreeSignee && entreePapier) {
    return {
      phase: "entree",
      texte: `Figé par la déclaration papier du ${formaterDateCourteFr(entreePapier.dateSignature)} (champs d'entrée)`
    };
  }
  if (entreeSignee) {
    const date = dateSignaturePhase(signatures, "entree");
    return { phase: "entree", texte: `Figé par la signature d'entrée${date ? ` du ${date}` : ""} (champs d'entrée)` };
  }
  return null;
}

// À combiner avec `rounded border` : la bordure transparente garde la même
// taille de champ dans les deux états.
export function classeChamp(editable: boolean): string {
  return editable ? "border-slate-300 bg-white text-slate-900" : "resize-none border-transparent bg-slate-100 text-slate-600";
}

export const CLASSE_SELECT =
  "rounded border border-slate-300 bg-white px-1 py-0.5 text-sm text-slate-900 disabled:appearance-none disabled:border-transparent disabled:bg-slate-100 disabled:text-slate-600 disabled:opacity-100";
