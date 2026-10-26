import { forwardRef, useImperativeHandle, useState } from "react";
import type { LigneCle, LigneCleInput, TypeCle } from "../api/etats-des-lieux";
import type { EtapeHandle } from "./etape-handle";
import { ChampReplie, ReferenceLectureSeule } from "./ui";
import { champEditable } from "./verrou-champs-commun";

const TYPES_CLE_FIXES: { valeur: TypeCle; label: string }[] = [
  { valeur: "immeuble", label: "Clés d'immeuble" },
  { valeur: "porte_entree", label: "Clés porte d'entrée" },
  { valeur: "boite_lettres", label: "Boîte aux lettres" },
  { valeur: "cave", label: "Clés cave" },
  { valeur: "badge_portail", label: "Badge ou clé portail" },
  { valeur: "parking", label: "Parking" }
];

interface LigneEditable {
  id?: string | undefined;
  typeCle: TypeCle;
  label: string;
  libelleAutre: string;
  nombre: string;
  nombreReference: number | null;
  commentaire: string;
}

function initialiser(lignes: LigneCle[], mode: "entree" | "sortie"): LigneEditable[] {
  const actives = lignes.filter((l) => l.archivedAt === null);
  const fixes = TYPES_CLE_FIXES.map(({ valeur, label }) => {
    const existante = actives.find((l) => l.typeCle === valeur) ?? null;
    return {
      id: existante?.id,
      typeCle: valeur,
      label,
      libelleAutre: "",
      nombre: String((mode === "entree" ? existante?.nombreEntree : existante?.nombreSortie) ?? ""),
      nombreReference: mode === "sortie" ? (existante?.nombreEntree ?? null) : null,
      commentaire: existante?.commentaire ?? ""
    };
  });
  const autres = actives
    .filter((l) => l.typeCle === "autre")
    .map((l) => ({
      id: l.id,
      typeCle: "autre" as TypeCle,
      label: l.libelleAutre || "Autre",
      libelleAutre: l.libelleAutre ?? "",
      nombre: String((mode === "entree" ? l.nombreEntree : l.nombreSortie) ?? ""),
      nombreReference: mode === "sortie" ? (l.nombreEntree ?? null) : null,
      commentaire: l.commentaire ?? ""
    }));
  return [...fixes, ...autres];
}

// Clés : soumission de toute la liste en un seul "Suivant" (upsert par id
// côté backend, jamais un remplacement en bloc) — colonne unique active
// selon `mode`, référence lecture seule de l'entrée à la sortie.
//
// entreeSignee/sortieSignee (chantier Signatures, revue du 2026-10-26) :
// une ligne EXISTANTE (id connu) a typeCle/libelleAutre/commentaire gelés
// dès l'entrée signée ; une ligne NEUVE (pas encore d'id — "+ Ajouter une
// autre clé") n'a que libelleAutre (son identité) et nombre (sortie)
// éditables, jamais commentaire. Une fois la sortie signée, tout est
// lecture seule (voir verrou-champs-commun.ts, même règle que le verrou
// backend).
export const ClesStepScreen = forwardRef<
  EtapeHandle,
  {
    lignes: LigneCle[];
    mode: "entree" | "sortie";
    entreeSignee: boolean;
    sortieSignee: boolean;
    onSubmit: (lignes: LigneCleInput[]) => Promise<void>;
  }
>(function ClesStepScreen({ lignes, mode, entreeSignee, sortieSignee, onSubmit }, ref) {
  const [etat, setEtat] = useState<LigneEditable[]>(() => initialiser(lignes, mode));

  useImperativeHandle(ref, () => ({
    submit: async () => {
      const payload: LigneCleInput[] = etat
        .filter((l) => l.typeCle !== "autre" || l.libelleAutre.trim())
        .map((l) => ({
          ...(l.id && { id: l.id }),
          typeCle: l.typeCle,
          ...(l.typeCle === "autre" && { libelleAutre: l.libelleAutre.trim() }),
          ...(l.nombre !== "" && { [mode === "entree" ? "nombreEntree" : "nombreSortie"]: Number(l.nombre) }),
          ...(l.commentaire && { commentaire: l.commentaire })
        }));
      await onSubmit(payload);
    }
  }));

  function setLigne(index: number, patch: Partial<LigneEditable>): void {
    setEtat((v) => v.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  const nombreAutres = etat.filter((l) => l.typeCle === "autre").length;

  return (
    <div className="space-y-5">
      {etat.map((ligne, index) => {
        const existante = ligne.id !== undefined;
        const libelleEditable = champEditable("identite", existante, entreeSignee, sortieSignee);
        const nombreEditable = champEditable("sortie", existante, entreeSignee, sortieSignee);
        const commentaireEditable = champEditable("commune", existante, entreeSignee, sortieSignee);

        return (
          <div
            key={ligne.id ?? `${ligne.typeCle}-${index}`}
            className="space-y-2 border-b border-slate-100 pb-4 last:border-0"
          >
            {ligne.typeCle === "autre" ? (
              <input
                value={ligne.libelleAutre}
                onChange={(e) => setLigne(index, { libelleAutre: e.target.value })}
                placeholder="Autre clé (libellé)"
                readOnly={!libelleEditable}
                className={`w-full rounded-md border px-3 py-2 text-base font-semibold ${
                  libelleEditable ? "border-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              />
            ) : (
              <h3 className="text-base font-semibold text-slate-800">{ligne.label}</h3>
            )}

            {mode === "sortie" && ligne.nombreReference !== null && (
              <ReferenceLectureSeule>Entrée : {ligne.nombreReference}</ReferenceLectureSeule>
            )}

            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600">Nombre</label>
              <input
                type="number"
                min={0}
                value={ligne.nombre}
                onChange={(e) => setLigne(index, { nombre: e.target.value })}
                readOnly={!nombreEditable}
                className={`w-20 rounded-md border px-2 py-2 text-base ${
                  nombreEditable ? "border-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              />
            </div>

            {/* commentaire : champ commun, jamais éditable sur une ligne
                neuve — et rien à montrer non plus dans ce cas (aucune
                valeur n'a jamais pu être saisie). */}
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

      {nombreAutres < 2 && !sortieSignee && (
        <button
          type="button"
          onClick={() =>
            setEtat((v) => [
              ...v,
              {
                typeCle: "autre",
                label: "Autre",
                libelleAutre: "",
                nombre: "",
                nombreReference: null,
                commentaire: ""
              }
            ])
          }
          className="text-sm text-indigo-700 underline underline-offset-2"
        >
          + Ajouter une autre clé
        </button>
      )}
    </div>
  );
});
