import { useEffect, useState } from "react";
import type { EtatElement, PieceRow } from "./api";
import type { ElementDef } from "./pieces-config";

const ETATS: EtatElement[] = ["M", "P", "B", "TB"];

function EtatSelect({ value, onChange }: { value: string; onChange: (valeur: string) => void }): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-slate-300 px-1 py-0.5 text-sm"
    >
      <option value="">—</option>
      {ETATS.map((etat) => (
        <option key={etat} value={etat}>
          {etat}
        </option>
      ))}
    </select>
  );
}

interface ChampsElement {
  description: string;
  etatEntree: string;
  etatSortie: string;
  nombre: string;
}

function construireValeursInitiales(elements: ElementDef[], row: PieceRow | null): Record<string, ChampsElement> {
  const valeurs: Record<string, ChampsElement> = {};
  for (const el of elements) {
    valeurs[el.prefix] = {
      description: (row?.[`${el.prefix}Description`] as string | null | undefined) ?? "",
      etatEntree: (row?.[`${el.prefix}EtatEntree`] as string | null | undefined) ?? "",
      etatSortie: (row?.[`${el.prefix}EtatSortie`] as string | null | undefined) ?? "",
      nombre: el.avecNombre ? String(row?.[`${el.prefix}Nombre`] ?? "") : ""
    };
  }
  return valeurs;
}

// Tableau dense (Élément / Description / État entrée / État sortie) pour
// une pièce — pilote son rendu depuis `elements` (voir pieces-config.ts)
// plutôt que dupliquer un composant par pièce. Sauvegarde explicite (pas
// d'auto-save au blur, même convention que le reste de l'app — ex.
// EditBailForm) : les valeurs affichées reflètent toujours l'état
// réellement enregistré tant qu'on n'a pas cliqué "Enregistrer".
export function PieceCard({
  titre,
  elements,
  row,
  onSave,
  libelleEditable = false
}: {
  titre: string;
  elements: ElementDef[];
  row: PieceRow | null;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  libelleEditable?: boolean;
}): React.JSX.Element {
  const [valeurs, setValeurs] = useState(() => construireValeursInitiales(elements, row));
  const [libelle, setLibelle] = useState(row?.libelle ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValeurs(construireValeursInitiales(elements, row));
    setLibelle(row?.libelle ?? "");
  }, [row, elements]);

  function setChamp(prefix: string, champ: keyof ChampsElement, valeur: string): void {
    setValeurs((v) => ({ ...v, [prefix]: { ...(v[prefix] as ChampsElement), [champ]: valeur } }));
  }

  async function handleSave(): Promise<void> {
    setError(null);
    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (libelleEditable) {
        payload.libelle = libelle;
      }
      for (const el of elements) {
        const champs = valeurs[el.prefix];
        if (!champs) {
          continue;
        }
        const elementPayload: Record<string, unknown> = { description: champs.description };
        if (champs.etatEntree) {
          elementPayload.etatEntree = champs.etatEntree;
        }
        if (champs.etatSortie) {
          elementPayload.etatSortie = champs.etatSortie;
        }
        if (el.avecNombre && champs.nombre !== "") {
          elementPayload.nombre = Number(champs.nombre);
        }
        payload[el.prefix] = elementPayload;
      }
      await onSave(payload);
    } catch {
      setError("Impossible d'enregistrer cette pièce");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        {libelleEditable ? (
          <input
            value={libelle}
            onChange={(e) => setLibelle(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm font-semibold text-slate-700"
          />
        ) : (
          <h4 className="text-sm font-semibold text-slate-700">{titre}</h4>
        )}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="shrink-0 rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {isSaving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-1 pr-2 font-medium">Élément</th>
            <th className="py-1 pr-2 font-medium">Description</th>
            <th className="py-1 pr-2 font-medium">État entrée</th>
            <th className="py-1 font-medium">État sortie</th>
          </tr>
        </thead>
        <tbody>
          {elements.map((el) => (
            <tr key={el.prefix} className="border-b border-slate-100">
              <td className="py-1 pr-2 align-top">
                {el.label}
                {el.avecNombre && (
                  <input
                    value={valeurs[el.prefix]?.nombre ?? ""}
                    onChange={(e) => setChamp(el.prefix, "nombre", e.target.value)}
                    placeholder="Nb"
                    className="ml-2 w-12 rounded border border-slate-300 px-1 py-0.5 text-xs"
                  />
                )}
              </td>
              <td className="py-1 pr-2">
                <input
                  value={valeurs[el.prefix]?.description ?? ""}
                  onChange={(e) => setChamp(el.prefix, "description", e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </td>
              <td className="py-1 pr-2">
                <EtatSelect
                  value={valeurs[el.prefix]?.etatEntree ?? ""}
                  onChange={(v) => setChamp(el.prefix, "etatEntree", v)}
                />
              </td>
              <td className="py-1">
                <EtatSelect
                  value={valeurs[el.prefix]?.etatSortie ?? ""}
                  onChange={(v) => setChamp(el.prefix, "etatSortie", v)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Pièces à occurrences multiples (chambres, salles de bain, wc, autres
// pièces) : une PieceCard par instance existante + un bouton d'ajout tant
// que le maximum du modèle réel n'est pas atteint.
export function MultiPieceSection({
  titrePrefixe,
  elements,
  rows,
  max,
  onSave,
  avecLibelle = false
}: {
  titrePrefixe: string;
  elements: ElementDef[];
  rows: PieceRow[];
  max: number;
  onSave: (numero: number, payload: Record<string, unknown>) => Promise<void>;
  avecLibelle?: boolean;
}): React.JSX.Element {
  const numerosExistants = rows.map((r) => r.numero ?? 0);
  const prochainNumero = numerosExistants.length > 0 ? Math.max(...numerosExistants) + 1 : 1;
  const [nouveauLibelle, setNouveauLibelle] = useState("");
  const [ajoutEnCours, setAjoutEnCours] = useState(false);

  async function handleAjouter(): Promise<void> {
    if (avecLibelle && !nouveauLibelle.trim()) {
      return;
    }
    setAjoutEnCours(true);
    try {
      await onSave(prochainNumero, avecLibelle ? { libelle: nouveauLibelle.trim() } : {});
      setNouveauLibelle("");
    } finally {
      setAjoutEnCours(false);
    }
  }

  return (
    <div className="space-y-3">
      {rows
        .slice()
        .sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0))
        .map((row) => (
          <PieceCard
            key={row.id}
            titre={avecLibelle ? row.libelle || `${titrePrefixe} ${row.numero}` : `${titrePrefixe} ${row.numero}`}
            elements={elements}
            row={row}
            libelleEditable={avecLibelle}
            onSave={(payload) => onSave(row.numero ?? 0, payload)}
          />
        ))}
      {numerosExistants.length < max &&
        (avecLibelle ? (
          <div className="flex items-center gap-2">
            <input
              value={nouveauLibelle}
              onChange={(e) => setNouveauLibelle(e.target.value)}
              placeholder="Libellé de la pièce (ex. Bureau)"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => void handleAjouter()}
              disabled={ajoutEnCours || !nouveauLibelle.trim()}
              className="text-sm text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
            >
              {ajoutEnCours ? "Ajout…" : "+ Ajouter"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void handleAjouter()}
            disabled={ajoutEnCours}
            className="text-sm text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
          >
            {ajoutEnCours ? "Ajout…" : `+ Ajouter ${titrePrefixe.toLowerCase()} ${prochainNumero}`}
          </button>
        ))}
    </div>
  );
}
