import { forwardRef, useImperativeHandle, useState } from "react";
import type { Compteurs } from "../api/etats-des-lieux";
import type { EtapeHandle } from "./etape-handle";
import { ReferenceLectureSeule } from "./ui";

interface ChampDef {
  cle: string;
  label: string;
}

const CHAMPS_ELECTRICITE: ChampDef[] = [
  { cle: "NumeroCompteur", label: "N° compteur" },
  { cle: "ReleveHp", label: "Relève HP" },
  { cle: "ReleveHc", label: "Relève HC" },
  { cle: "AncienOccupant", label: "Ancien occupant" }
];
const CHAMPS_GAZ: ChampDef[] = [
  { cle: "NumeroCompteur", label: "N° compteur" },
  { cle: "Releve", label: "Relève" }
];
const CHAMPS_EAU: ChampDef[] = [
  { cle: "ReleveFroide", label: "Relève froide" },
  { cle: "ReleveChaude", label: "Relève chaude" }
];

function cleChamp(groupe: string, cle: string, mode: "entree" | "sortie"): string {
  return `${groupe}${cle}${mode === "entree" ? "Entree" : "Sortie"}`;
}

function Groupe({
  titre,
  groupe,
  champs,
  compteurs,
  mode,
  valeurs,
  setValeur
}: {
  titre: string;
  groupe: string;
  champs: ChampDef[];
  compteurs: Compteurs | null;
  mode: "entree" | "sortie";
  valeurs: Record<string, string>;
  setValeur: (cle: string, valeur: string) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-slate-800">{titre}</h3>
      {champs.map(({ cle, label }) => {
        const champActif = cleChamp(groupe, cle, mode);
        const champReference = mode === "sortie" ? (compteurs?.[cleChamp(groupe, cle, "entree") as keyof Compteurs] as string | null) : null;
        return (
          <div key={cle} className="space-y-1">
            <label className="text-sm text-slate-600">{label}</label>
            {mode === "sortie" && champReference && (
              <ReferenceLectureSeule>Entrée : {champReference}</ReferenceLectureSeule>
            )}
            <input
              value={valeurs[champActif] ?? ""}
              onChange={(e) => setValeur(champActif, e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-3 text-base"
            />
          </div>
        );
      })}
    </div>
  );
}

// Compteurs : mêmes principes que PieceStepScreen (colonne unique active
// selon `mode`, référence lecture seule de l'entrée à la sortie) —
// section dédiée plutôt que réutiliser PieceStepScreen, la forme des
// champs (électricité/gaz/eau) étant structurellement différente d'une
// pièce.
export const CompteursStepScreen = forwardRef<
  EtapeHandle,
  {
    compteurs: Compteurs | null;
    mode: "entree" | "sortie";
    onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  }
>(function CompteursStepScreen({ compteurs, mode, onSubmit }, ref) {
  const [valeurs, setValeurs] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [groupe, champs] of [
      ["electricite", CHAMPS_ELECTRICITE],
      ["gaz", CHAMPS_GAZ],
      ["eau", CHAMPS_EAU]
    ] as const) {
      for (const { cle } of champs) {
        const champActif = cleChamp(groupe, cle, mode);
        initial[champActif] = (compteurs?.[champActif as keyof Compteurs] as string | null) ?? "";
      }
    }
    return initial;
  });

  useImperativeHandle(ref, () => ({
    submit: async () => {
      const suffixe = mode === "entree" ? "Entree" : "Sortie";
      const construireGroupe = (groupe: string, champs: ChampDef[]): Record<string, unknown> => {
        const g: Record<string, unknown> = {};
        for (const { cle } of champs) {
          const valeur = valeurs[cleChamp(groupe, cle, mode)];
          if (valeur) {
            // decapitalise la première lettre : "NumeroCompteur" -> "numeroCompteur"
            const nomChamp = `${cle.charAt(0).toLowerCase()}${cle.slice(1)}${suffixe}`;
            g[nomChamp] = valeur;
          }
        }
        return g;
      };
      await onSubmit({
        electricite: construireGroupe("electricite", CHAMPS_ELECTRICITE),
        gaz: construireGroupe("gaz", CHAMPS_GAZ),
        eau: construireGroupe("eau", CHAMPS_EAU)
      });
    }
  }));

  function setValeur(cle: string, valeur: string): void {
    setValeurs((v) => ({ ...v, [cle]: valeur }));
  }

  return (
    <div className="space-y-8">
      <Groupe
        titre="Électricité"
        groupe="electricite"
        champs={CHAMPS_ELECTRICITE}
        compteurs={compteurs}
        mode={mode}
        valeurs={valeurs}
        setValeur={setValeur}
      />
      <Groupe
        titre="Gaz"
        groupe="gaz"
        champs={CHAMPS_GAZ}
        compteurs={compteurs}
        mode={mode}
        valeurs={valeurs}
        setValeur={setValeur}
      />
      <Groupe
        titre="Eau"
        groupe="eau"
        champs={CHAMPS_EAU}
        compteurs={compteurs}
        mode={mode}
        valeurs={valeurs}
        setValeur={setValeur}
      />
    </div>
  );
});
