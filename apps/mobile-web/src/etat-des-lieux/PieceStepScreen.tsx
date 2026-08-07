import { forwardRef, useImperativeHandle, useState } from "react";
import type { PieceRow } from "../api/etats-des-lieux";
import type { EtatElement } from "../api/etats-des-lieux";
import type { EtapeHandle } from "./etape-handle";
import type { ElementDef } from "./pieces-config";
import { BoutonsEtatPiece, ChampReplie, ReferenceLectureSeule } from "./ui";

interface ChampsElement {
  description: string;
  etat: string;
  nombre: string;
}

const LABEL_ETAT: Record<EtatElement, string> = { M: "Mauvais", P: "Passable", B: "Bon", TB: "Très bon" };

function initialiser(elements: ElementDef[], row: PieceRow | null, mode: "entree" | "sortie"): Record<string, ChampsElement> {
  const valeurs: Record<string, ChampsElement> = {};
  for (const el of elements) {
    const cleEtat = mode === "entree" ? `${el.prefix}EtatEntree` : `${el.prefix}EtatSortie`;
    valeurs[el.prefix] = {
      description: (row?.[`${el.prefix}Description`] as string | null | undefined) ?? "",
      etat: (row?.[cleEtat] as string | null | undefined) ?? "",
      nombre: el.avecNombre ? String(row?.[`${el.prefix}Nombre`] ?? "") : ""
    };
  }
  return valeurs;
}

// Une pièce du parcours pas-à-pas : une seule colonne d'état affichée à
// la fois (décision actée) — entrée OU sortie selon `mode`, jamais les
// deux. À la sortie, la valeur d'entrée déjà capturée s'affiche en
// lecture seule à côté du champ de saisie sortie.
export const PieceStepScreen = forwardRef<
  EtapeHandle,
  {
    elements: ElementDef[];
    row: PieceRow | null;
    mode: "entree" | "sortie";
    libelleFixe?: string;
    onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  }
>(function PieceStepScreen({ elements, row, mode, libelleFixe, onSubmit }, ref) {
  const [valeurs, setValeurs] = useState(() => initialiser(elements, row, mode));

  useImperativeHandle(ref, () => ({
    submit: async () => {
      const payload: Record<string, unknown> = {};
      if (libelleFixe !== undefined) {
        payload.libelle = row?.libelle || libelleFixe;
      }
      for (const el of elements) {
        const champs = valeurs[el.prefix];
        if (!champs) {
          continue;
        }
        const elementPayload: Record<string, unknown> = { description: champs.description };
        if (champs.etat) {
          elementPayload[mode === "entree" ? "etatEntree" : "etatSortie"] = champs.etat;
        }
        if (el.avecNombre && champs.nombre !== "") {
          elementPayload.nombre = Number(champs.nombre);
        }
        payload[el.prefix] = elementPayload;
      }
      await onSubmit(payload);
    }
  }));

  function setChamp(prefix: string, champ: keyof ChampsElement, valeur: string): void {
    setValeurs((v) => ({ ...v, [prefix]: { ...(v[prefix] as ChampsElement), [champ]: valeur } }));
  }

  return (
    <div className="space-y-6">
      {elements.map((el) => {
        const champs = valeurs[el.prefix];
        if (!champs) {
          return null;
        }
        const referenceEntree =
          mode === "sortie"
            ? ((row?.[`${el.prefix}EtatEntree`] as string | null | undefined) ?? null)
            : null;
        const referenceDescription =
          mode === "sortie" ? ((row?.[`${el.prefix}Description`] as string | null | undefined) ?? null) : null;

        return (
          <div key={el.prefix} className="space-y-2 border-b border-slate-100 pb-5 last:border-0">
            <h3 className="text-base font-semibold text-slate-800">{el.label}</h3>

            {mode === "sortie" && (referenceEntree || referenceDescription) && (
              <ReferenceLectureSeule>
                Entrée : {referenceEntree ? LABEL_ETAT[referenceEntree as EtatElement] : "—"}
                {referenceDescription ? ` — ${referenceDescription}` : ""}
              </ReferenceLectureSeule>
            )}

            <BoutonsEtatPiece value={champs.etat} onChange={(v) => setChamp(el.prefix, "etat", v)} />

            {el.avecNombre && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600">Nombre</label>
                <input
                  type="number"
                  min={0}
                  value={champs.nombre}
                  onChange={(e) => setChamp(el.prefix, "nombre", e.target.value)}
                  className="w-20 rounded-md border border-slate-300 px-2 py-2 text-base"
                />
              </div>
            )}

            <ChampReplie
              label="+ Commentaire"
              value={champs.description}
              onChange={(v) => setChamp(el.prefix, "description", v)}
              placeholder="Description / détails"
            />
          </div>
        );
      })}
    </div>
  );
});
