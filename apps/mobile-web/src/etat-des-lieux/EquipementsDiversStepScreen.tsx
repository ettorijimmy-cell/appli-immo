import { forwardRef, useImperativeHandle, useState } from "react";
import type { EtatInventaire, LigneEquipementDivers, LigneEquipementDiversInput } from "../api/etats-des-lieux";
import type { EtapeHandle } from "./etape-handle";
import { BoutonsEtatInventaire, ChampReplie, ReferenceLectureSeule } from "./ui";

interface LigneEditable {
  id?: string;
  libelle: string;
  nombre: string;
  etat: string;
  nombreReference: number | null;
  etatReference: EtatInventaire | null;
  commentaire: string;
}

function initialiser(lignes: LigneEquipementDivers[], mode: "entree" | "sortie"): LigneEditable[] {
  return lignes
    .filter((l) => l.archivedAt === null)
    .map((l) => ({
      id: l.id,
      libelle: l.libelle,
      nombre: String((mode === "entree" ? l.nombreEntree : l.nombreSortie) ?? ""),
      etat: (mode === "entree" ? l.etatEntree : l.etatSortie) ?? "",
      nombreReference: mode === "sortie" ? (l.nombreEntree ?? null) : null,
      etatReference: mode === "sortie" ? l.etatEntree : null,
      commentaire: l.commentaire ?? ""
    }));
}

const LABEL_ETAT: Record<EtatInventaire, string> = { bon: "Bon", dusage: "D'usage", mauvais: "Mauvais" };

// Liste extensible, libellé libre — même principe que ClesStepScreen
// (soumission de toute la liste en un "Suivant", upsert par id).
export const EquipementsDiversStepScreen = forwardRef<
  EtapeHandle,
  {
    lignes: LigneEquipementDivers[];
    mode: "entree" | "sortie";
    onSubmit: (lignes: LigneEquipementDiversInput[]) => Promise<void>;
  }
>(function EquipementsDiversStepScreen({ lignes, mode, onSubmit }, ref) {
  const [etat, setEtat] = useState<LigneEditable[]>(() => initialiser(lignes, mode));

  useImperativeHandle(ref, () => ({
    submit: async () => {
      const payload: LigneEquipementDiversInput[] = etat
        .filter((l) => l.libelle.trim())
        .map((l) => ({
          ...(l.id && { id: l.id }),
          libelle: l.libelle.trim(),
          ...(l.nombre !== "" && { [mode === "entree" ? "nombreEntree" : "nombreSortie"]: Number(l.nombre) }),
          ...(l.etat && { [mode === "entree" ? "etatEntree" : "etatSortie"]: l.etat }),
          ...(l.commentaire && { commentaire: l.commentaire })
        }));
      await onSubmit(payload);
    }
  }));

  function setLigne(index: number, patch: Partial<LigneEditable>): void {
    setEtat((v) => v.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  return (
    <div className="space-y-5">
      {etat.length === 0 && <p className="text-sm text-slate-500">Aucun équipement pour le moment.</p>}

      {etat.map((ligne, index) => (
        <div key={ligne.id ?? index} className="space-y-2 border-b border-slate-100 pb-4 last:border-0">
          <input
            value={ligne.libelle}
            onChange={(e) => setLigne(index, { libelle: e.target.value })}
            placeholder="Équipement (ex. Store banne)"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-base font-semibold"
          />

          {mode === "sortie" && (ligne.nombreReference !== null || ligne.etatReference) && (
            <ReferenceLectureSeule>
              Entrée : {ligne.nombreReference ?? "—"}
              {ligne.etatReference ? ` — ${LABEL_ETAT[ligne.etatReference]}` : ""}
            </ReferenceLectureSeule>
          )}

          <BoutonsEtatInventaire value={ligne.etat} onChange={(v) => setLigne(index, { etat: v })} />

          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Nombre</label>
            <input
              type="number"
              min={0}
              value={ligne.nombre}
              onChange={(e) => setLigne(index, { nombre: e.target.value })}
              className="w-20 rounded-md border border-slate-300 px-2 py-2 text-base"
            />
          </div>

          <ChampReplie
            label="+ Commentaire"
            value={ligne.commentaire}
            onChange={(v) => setLigne(index, { commentaire: v })}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          setEtat((v) => [
            ...v,
            { libelle: "", nombre: "", etat: "", nombreReference: null, etatReference: null, commentaire: "" }
          ])
        }
        className="text-sm text-indigo-700 underline underline-offset-2"
      >
        + Ajouter un équipement
      </button>
    </div>
  );
});
