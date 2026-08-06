import { useState } from "react";
import { ARCHIVED_ROW_CLASSNAME, ArchiveBadge } from "../components/ArchiveFilter";
import type {
  CategorieInventaire,
  ElementInventaireMeuble,
  EtatInventaire,
  LigneInventaire,
  LigneInventaireInput
} from "./api";

const ETATS_INVENTAIRE: { valeur: EtatInventaire; label: string }[] = [
  { valeur: "bon", label: "Bon" },
  { valeur: "dusage", label: "D'usage" },
  { valeur: "mauvais", label: "Mauvais" }
];

const LABEL_CATEGORIE: Record<CategorieInventaire, string> = {
  meuble: "Meubles",
  electromenager: "Électroménager",
  vaisselle_linge: "Vaisselle / linge"
};

function EtatInventaireSelect({
  value,
  onChange
}: {
  value: string;
  onChange: (valeur: string) => void;
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-slate-300 px-1 py-0.5 text-sm"
    >
      <option value="">—</option>
      {ETATS_INVENTAIRE.map(({ valeur, label }) => (
        <option key={valeur} value={valeur}>
          {label}
        </option>
      ))}
    </select>
  );
}

// Uniquement pour un bail meublé (règle applicative, pas de contrainte de
// schéma) — pilotée par le catalogue de référence (88 lignes seedées,
// GET /etats-des-lieux/catalogue-inventaire), pas par un texte libre :
// chaque poste du catalogue est affiché, avec ou sans ligne saisie.
export function InventaireSection({
  catalogue,
  lignes,
  onSaveLigne,
  onArchiver
}: {
  catalogue: ElementInventaireMeuble[];
  lignes: LigneInventaire[];
  onSaveLigne: (ligne: LigneInventaireInput) => Promise<void>;
  onArchiver: (elementId: string) => Promise<void>;
}): React.JSX.Element {
  const actives = lignes.filter((l) => l.archivedAt === null);
  const archivees = lignes.filter((l) => l.archivedAt !== null);
  const parElementId = new Map(actives.map((l) => [l.elementId, l]));

  const categories: CategorieInventaire[] = ["meuble", "electromenager", "vaisselle_linge"];

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h4 className="mb-3 text-sm font-semibold text-slate-700">Inventaire meublé</h4>
      {categories.map((categorie) => {
        const elements = catalogue
          .filter((e) => e.categorie === categorie)
          .sort((a, b) => a.ordreAffichage - b.ordreAffichage);
        if (elements.length === 0) {
          return null;
        }
        return (
          <div key={categorie} className="mb-4">
            <h5 className="mb-1 text-xs font-semibold uppercase text-slate-400">{LABEL_CATEGORIE[categorie]}</h5>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1 pr-2 font-medium">Élément</th>
                  <th className="py-1 pr-2 font-medium">Nb entrée</th>
                  <th className="py-1 pr-2 font-medium">État entrée</th>
                  <th className="py-1 pr-2 font-medium">Nb sortie</th>
                  <th className="py-1 pr-2 font-medium">État sortie</th>
                  <th className="py-1 pr-2 font-medium">Commentaire</th>
                  <th className="py-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {elements.map((element) => (
                  <LigneInventaireRow
                    key={element.id}
                    element={element}
                    ligne={parElementId.get(element.id) ?? null}
                    onSave={onSaveLigne}
                    onArchiver={onArchiver}
                  />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {archivees.length > 0 && (
        <div>
          <h5 className="mb-1 text-xs font-semibold uppercase text-slate-400">Retirés</h5>
          <table className="w-full text-left text-sm">
            <tbody>
              {archivees.map((ligne) => (
                <tr key={ligne.id} className={`border-b border-slate-100 ${ARCHIVED_ROW_CLASSNAME}`}>
                  <td className="py-1 pr-2">
                    {ligne.elementLibelle}
                    <ArchiveBadge />
                  </td>
                  <td className="py-1 pr-2">{ligne.nombreEntree ?? "—"}</td>
                  <td className="py-1 pr-2">{ligne.etatEntree ?? "—"}</td>
                  <td className="py-1 pr-2">{ligne.nombreSortie ?? "—"}</td>
                  <td className="py-1 pr-2">{ligne.etatSortie ?? "—"}</td>
                  <td className="py-1 pr-2">{ligne.commentaire ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LigneInventaireRow({
  element,
  ligne,
  onSave,
  onArchiver
}: {
  element: ElementInventaireMeuble;
  ligne: LigneInventaire | null;
  onSave: (ligne: LigneInventaireInput) => Promise<void>;
  onArchiver: (elementId: string) => Promise<void>;
}): React.JSX.Element {
  const [nombreEntree, setNombreEntree] = useState(ligne?.nombreEntree?.toString() ?? "");
  const [etatEntree, setEtatEntree] = useState(ligne?.etatEntree ?? "");
  const [nombreSortie, setNombreSortie] = useState(ligne?.nombreSortie?.toString() ?? "");
  const [etatSortie, setEtatSortie] = useState(ligne?.etatSortie ?? "");
  const [commentaire, setCommentaire] = useState(ligne?.commentaire ?? "");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    try {
      await onSave({
        elementId: element.id,
        ...(nombreEntree !== "" && { nombreEntree: Number(nombreEntree) }),
        ...(etatEntree && { etatEntree: etatEntree as EtatInventaire }),
        ...(nombreSortie !== "" && { nombreSortie: Number(nombreSortie) }),
        ...(etatSortie && { etatSortie: etatSortie as EtatInventaire }),
        ...(commentaire && { commentaire })
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <tr className="border-b border-slate-100">
      <td className="py-1 pr-2">{element.libelle}</td>
      <td className="py-1 pr-2">
        <input
          value={nombreEntree}
          onChange={(e) => setNombreEntree(e.target.value)}
          className="w-14 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="py-1 pr-2">
        <EtatInventaireSelect value={etatEntree} onChange={setEtatEntree} />
      </td>
      <td className="py-1 pr-2">
        <input
          value={nombreSortie}
          onChange={(e) => setNombreSortie(e.target.value)}
          className="w-14 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="py-1 pr-2">
        <EtatInventaireSelect value={etatSortie} onChange={setEtatSortie} />
      </td>
      <td className="py-1 pr-2">
        <input
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="py-1 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="mr-2 text-xs text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
        >
          {isSaving ? "…" : "Enregistrer"}
        </button>
        {ligne && (
          <button
            type="button"
            onClick={() => void onArchiver(element.id)}
            className="text-xs text-slate-500 hover:text-red-600"
          >
            Retirer
          </button>
        )}
      </td>
    </tr>
  );
}
