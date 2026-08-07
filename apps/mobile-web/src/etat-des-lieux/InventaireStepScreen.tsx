import { forwardRef, useImperativeHandle, useState } from "react";
import type {
  CategorieInventaire,
  ElementInventaireMeuble,
  EtatInventaire,
  LigneInventaire,
  LigneInventaireInput
} from "../api/etats-des-lieux";
import type { EtapeHandle } from "./etape-handle";
import { BoutonsEtatInventaire, ChampReplie, ReferenceLectureSeule } from "./ui";

const LABEL_CATEGORIE: Record<CategorieInventaire, string> = {
  meuble: "Meubles",
  electromenager: "Électroménager",
  vaisselle_linge: "Vaisselle / linge"
};
const LABEL_ETAT: Record<EtatInventaire, string> = { bon: "Bon", dusage: "D'usage", mauvais: "Mauvais" };

interface ChampsElement {
  nombre: string;
  etat: string;
  commentaire: string;
}

// Inventaire meublé : un step unique (comme côté desktop) piloté par le
// catalogue de référence (88 postes), pas de saisie libre — colonne
// unique active selon `mode`, référence lecture seule de l'entrée à la
// sortie.
export const InventaireStepScreen = forwardRef<
  EtapeHandle,
  {
    catalogue: ElementInventaireMeuble[];
    lignes: LigneInventaire[];
    mode: "entree" | "sortie";
    onSubmit: (lignes: LigneInventaireInput[]) => Promise<void>;
  }
>(function InventaireStepScreen({ catalogue, lignes, mode, onSubmit }, ref) {
  const actives = lignes.filter((l) => l.archivedAt === null);
  const parElementId = new Map(actives.map((l) => [l.elementId, l]));

  const [valeurs, setValeurs] = useState<Record<string, ChampsElement>>(() => {
    const initial: Record<string, ChampsElement> = {};
    for (const element of catalogue) {
      const existante = parElementId.get(element.id);
      initial[element.id] = {
        nombre: String((mode === "entree" ? existante?.nombreEntree : existante?.nombreSortie) ?? ""),
        etat: (mode === "entree" ? existante?.etatEntree : existante?.etatSortie) ?? "",
        commentaire: existante?.commentaire ?? ""
      };
    }
    return initial;
  });

  useImperativeHandle(ref, () => ({
    submit: async () => {
      const payload: LigneInventaireInput[] = [];
      for (const element of catalogue) {
        const champs = valeurs[element.id];
        if (!champs || (champs.nombre === "" && !champs.etat && !champs.commentaire)) {
          continue;
        }
        payload.push({
          elementId: element.id,
          ...(champs.nombre !== "" && { [mode === "entree" ? "nombreEntree" : "nombreSortie"]: Number(champs.nombre) }),
          ...(champs.etat && { [mode === "entree" ? "etatEntree" : "etatSortie"]: champs.etat })
        } as LigneInventaireInput);
        if (champs.commentaire) {
          payload[payload.length - 1]!.commentaire = champs.commentaire;
        }
      }
      await onSubmit(payload);
    }
  }));

  function setChamp(elementId: string, patch: Partial<ChampsElement>): void {
    setValeurs((v) => ({ ...v, [elementId]: { ...(v[elementId] as ChampsElement), ...patch } }));
  }

  const categories: CategorieInventaire[] = ["meuble", "electromenager", "vaisselle_linge"];

  return (
    <div className="space-y-8">
      {categories.map((categorie) => {
        const elements = catalogue
          .filter((e) => e.categorie === categorie)
          .sort((a, b) => a.ordreAffichage - b.ordreAffichage);
        if (elements.length === 0) {
          return null;
        }
        return (
          <div key={categorie} className="space-y-4">
            <h3 className="text-xs font-semibold uppercase text-slate-400">{LABEL_CATEGORIE[categorie]}</h3>
            {elements.map((element) => {
              const champs = valeurs[element.id];
              if (!champs) {
                return null;
              }
              const existante = parElementId.get(element.id);
              return (
                <div key={element.id} className="space-y-2 border-b border-slate-100 pb-4 last:border-0">
                  <h4 className="text-base font-medium text-slate-800">{element.libelle}</h4>

                  {mode === "sortie" && (existante?.nombreEntree != null || existante?.etatEntree) && (
                    <ReferenceLectureSeule>
                      Entrée : {existante?.nombreEntree ?? "—"}
                      {existante?.etatEntree ? ` — ${LABEL_ETAT[existante.etatEntree]}` : ""}
                    </ReferenceLectureSeule>
                  )}

                  <BoutonsEtatInventaire
                    value={champs.etat}
                    onChange={(v) => setChamp(element.id, { etat: v })}
                  />

                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-600">Nombre</label>
                    <input
                      type="number"
                      min={0}
                      value={champs.nombre}
                      onChange={(e) => setChamp(element.id, { nombre: e.target.value })}
                      className="w-20 rounded-md border border-slate-300 px-2 py-2 text-base"
                    />
                  </div>

                  <ChampReplie
                    label="+ Commentaire"
                    value={champs.commentaire}
                    onChange={(v) => setChamp(element.id, { commentaire: v })}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
});
