import type { Figement } from "./figement-carte";

export function BadgeFigement({ figement }: { figement: Figement | null }): React.JSX.Element | null {
  if (!figement) {
    return null;
  }
  const couleurs = figement.phase === "sortie" ? "bg-slate-700 text-white" : "bg-slate-200 text-slate-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${couleurs}`}>{figement.texte}</span>;
}
