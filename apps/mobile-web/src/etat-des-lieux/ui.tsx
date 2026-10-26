import { useState, type ReactNode } from "react";
import type { EtatElement, EtatInventaire } from "../api/etats-des-lieux";

const ETATS_PIECE: EtatElement[] = ["M", "P", "B", "TB"];
const ETATS_INVENTAIRE: { valeur: EtatInventaire; label: string }[] = [
  { valeur: "bon", label: "Bon" },
  { valeur: "dusage", label: "D'usage" },
  { valeur: "mauvais", label: "Mauvais" }
];

// Décision actée : M/P/B/TB en boutons tactiles larges, jamais un menu
// déroulant — même principe étendu à l'échelle bon/dusage/mauvais
// (BoutonsEtatInventaire ci-dessous), pour la même raison (saisie au
// pouce pendant une visite, jamais de liste à ouvrir).
export function BoutonsEtatPiece({
  value,
  onChange
}: {
  value: string;
  onChange: (valeur: EtatElement) => void;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-4 gap-2">
      {ETATS_PIECE.map((etat) => (
        <button
          key={etat}
          type="button"
          onClick={() => onChange(etat)}
          className={`rounded-md border py-3 text-base font-semibold ${
            value === etat
              ? "border-indigo-700 bg-indigo-700 text-white"
              : "border-slate-300 bg-white text-slate-700"
          }`}
        >
          {etat}
        </button>
      ))}
    </div>
  );
}

export function BoutonsEtatInventaire({
  value,
  onChange,
  disabled = false
}: {
  value: string;
  onChange: (valeur: EtatInventaire) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ETATS_INVENTAIRE.map(({ valeur, label }) => (
        <button
          key={valeur}
          type="button"
          onClick={() => onChange(valeur)}
          disabled={disabled}
          className={`rounded-md border py-2 text-sm font-semibold disabled:opacity-50 ${
            value === valeur
              ? "border-indigo-700 bg-indigo-700 text-white"
              : "border-slate-300 bg-white text-slate-700"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Commentaire replié par défaut, un tap pour l'ouvrir (décision actée) —
// garde chaque étape courte à l'écran, le détail reste disponible sans
// jamais s'imposer visuellement. `readOnly` (chantier Signatures, champ
// commun figé dès l'entrée signée) : toujours ouvert dès qu'il y a une
// valeur à montrer, jamais replié derrière un bouton qu'on ne peut plus
// de toute façon utiliser pour éditer.
export function ChampReplie({
  label,
  value,
  onChange,
  placeholder,
  readOnly = false
}: {
  label: string;
  value: string;
  onChange: (valeur: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}): React.JSX.Element {
  const [ouvert, setOuvert] = useState(value !== "" || readOnly);

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="text-sm text-indigo-700 underline underline-offset-2"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full rounded-md border px-3 py-2 text-base ${
          readOnly ? "border-slate-200 bg-slate-50 text-slate-500" : "border-slate-300"
        }`}
      />
    </div>
  );
}

// Référence lecture seule à la sortie (décision actée) : la valeur
// d'entrée s'affiche à côté du champ de saisie sortie, jamais modifiable
// depuis ce parcours (les corrections passent par la vue de relecture
// desktop).
export function ReferenceLectureSeule({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">{children}</p>;
}
