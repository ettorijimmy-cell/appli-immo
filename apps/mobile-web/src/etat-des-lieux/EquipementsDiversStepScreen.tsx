import { forwardRef, useImperativeHandle, useState } from "react";
import type { EtatInventaire, LigneEquipementDivers, LigneEquipementDiversInput } from "../api/etats-des-lieux";
import type { EtapeHandle } from "./etape-handle";
import { BoutonsEtatInventaire, ChampReplie, ReferenceLectureSeule } from "./ui";
import { champEditable } from "./verrou-champs-commun";

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
//
// entreeSignee/sortieSignee : même règle que ClesStepScreen — ligne
// existante (id connu) gelée sur libelle/commentaire dès l'entrée signée,
// ligne neuve limitée à libelle (identité) + sortie, tout verrouillé une
// fois la sortie signée (voir verrou-champs-commun.ts).
export const EquipementsDiversStepScreen = forwardRef<
  EtapeHandle,
  {
    lignes: LigneEquipementDivers[];
    mode: "entree" | "sortie";
    entreeSignee: boolean;
    sortieSignee: boolean;
    onSubmit: (lignes: LigneEquipementDiversInput[]) => Promise<void>;
  }
>(function EquipementsDiversStepScreen({ lignes, mode, entreeSignee, sortieSignee, onSubmit }, ref) {
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

      {etat.map((ligne, index) => {
        const existante = ligne.id !== undefined;
        const libelleEditable = champEditable("identite", existante, entreeSignee, sortieSignee);
        const champsSortieEditables = champEditable("sortie", existante, entreeSignee, sortieSignee);
        const commentaireEditable = champEditable("commune", existante, entreeSignee, sortieSignee);

        return (
          <div key={ligne.id ?? index} className="space-y-2 border-b border-slate-100 pb-4 last:border-0">
            <input
              value={ligne.libelle}
              onChange={(e) => setLigne(index, { libelle: e.target.value })}
              placeholder="Équipement (ex. Store banne)"
              readOnly={!libelleEditable}
              className={`w-full rounded-md border px-3 py-2 text-base font-semibold ${
                libelleEditable ? "border-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"
              }`}
            />

            {mode === "sortie" && (ligne.nombreReference !== null || ligne.etatReference) && (
              <ReferenceLectureSeule>
                Entrée : {ligne.nombreReference ?? "—"}
                {ligne.etatReference ? ` — ${LABEL_ETAT[ligne.etatReference]}` : ""}
              </ReferenceLectureSeule>
            )}

            <BoutonsEtatInventaire
              value={ligne.etat}
              onChange={(v) => setLigne(index, { etat: v })}
              disabled={!champsSortieEditables}
            />

            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600">Nombre</label>
              <input
                type="number"
                min={0}
                value={ligne.nombre}
                onChange={(e) => setLigne(index, { nombre: e.target.value })}
                readOnly={!champsSortieEditables}
                className={`w-20 rounded-md border px-2 py-2 text-base ${
                  champsSortieEditables ? "border-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              />
            </div>

            {/* commentaire : champ commun, jamais éditable sur une ligne
                neuve — rien à montrer non plus dans ce cas. */}
            {(commentaireEditable || (existante && ligne.commentaire)) && (
              <ChampReplie
                label="+ Commentaire"
                value={ligne.commentaire}
                onChange={(v) => setLigne(index, { commentaire: v })}
                readOnly={!commentaireEditable}
              />
            )}
          </div>
        );
      })}

      {!sortieSignee && (
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
      )}
    </div>
  );
});
