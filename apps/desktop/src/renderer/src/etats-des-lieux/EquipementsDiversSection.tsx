import { champModifiable, CHAMPS_IDENTITE_EQUIPEMENTS_DIVERS, CLASSIFICATION_EQUIPEMENTS_DIVERS } from "core";
import { useState } from "react";
import { ARCHIVED_ROW_CLASSNAME, ArchiveBadge } from "../components/ArchiveFilter";
import { ApiError } from "../lib/authenticated-fetch";
import type { EtatInventaire, LigneEquipementDivers, LigneEquipementDiversInput } from "./api";

const ETATS_INVENTAIRE: { valeur: EtatInventaire; label: string }[] = [
  { valeur: "bon", label: "Bon" },
  { valeur: "dusage", label: "D'usage" },
  { valeur: "mauvais", label: "Mauvais" }
];

function EtatInventaireSelect({
  value,
  onChange,
  disabled = false
}: {
  value: string;
  onChange: (valeur: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="rounded border border-slate-300 px-1 py-0.5 text-sm disabled:bg-slate-50 disabled:text-slate-500"
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

// Liste extensible, libellé saisi librement — section "ÉQUIPEMENTS
// DIVERS" du modèle réel, applicable à tout bail (vide ou meublé),
// distincte de l'inventaire meublé (catalogue fixe).
//
// entreeSignee/sortieSignee : même classification que ClesSection (core,
// CLASSIFICATION_EQUIPEMENTS_DIVERS/CHAMPS_IDENTITE_EQUIPEMENTS_DIVERS).
export function EquipementsDiversSection({
  lignes,
  entreeSignee,
  sortieSignee,
  onSaveLigne,
  onArchiver
}: {
  lignes: LigneEquipementDivers[];
  entreeSignee: boolean;
  sortieSignee: boolean;
  onSaveLigne: (ligne: LigneEquipementDiversInput) => Promise<void>;
  onArchiver: (id: string) => Promise<void>;
}): React.JSX.Element {
  const actives = lignes.filter((l) => l.archivedAt === null);
  const archivees = lignes.filter((l) => l.archivedAt !== null);

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h4 className="mb-2 text-sm font-semibold text-slate-700">Équipements divers</h4>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-1 pr-2 font-medium">Libellé</th>
            <th className="py-1 pr-2 font-medium">Nb entrée</th>
            <th className="py-1 pr-2 font-medium">État entrée</th>
            <th className="py-1 pr-2 font-medium">Nb sortie</th>
            <th className="py-1 pr-2 font-medium">État sortie</th>
            <th className="py-1 pr-2 font-medium">Commentaire</th>
            <th className="py-1 font-medium" />
          </tr>
        </thead>
        <tbody>
          {actives.map((ligne) => (
            <LigneEquipementRow
              key={ligne.id}
              ligne={ligne}
              entreeSignee={entreeSignee}
              sortieSignee={sortieSignee}
              onSave={onSaveLigne}
              onArchiver={onArchiver}
            />
          ))}
          {archivees.map((ligne) => (
            <tr key={ligne.id} className={`border-b border-slate-100 ${ARCHIVED_ROW_CLASSNAME}`}>
              <td className="py-1 pr-2">
                {ligne.libelle}
                <ArchiveBadge />
              </td>
              <td className="py-1 pr-2">{ligne.nombreEntree ?? "—"}</td>
              <td className="py-1 pr-2">{ligne.etatEntree ?? "—"}</td>
              <td className="py-1 pr-2">{ligne.nombreSortie ?? "—"}</td>
              <td className="py-1 pr-2">{ligne.etatSortie ?? "—"}</td>
              <td className="py-1 pr-2">{ligne.commentaire ?? "—"}</td>
              <td className="py-1" />
            </tr>
          ))}
        </tbody>
      </table>
      {!sortieSignee && <NouvelEquipementForm onSave={onSaveLigne} />}
    </div>
  );
}

function LigneEquipementRow({
  ligne,
  entreeSignee,
  sortieSignee,
  onSave,
  onArchiver
}: {
  ligne: LigneEquipementDivers;
  entreeSignee: boolean;
  sortieSignee: boolean;
  onSave: (ligne: LigneEquipementDiversInput) => Promise<void>;
  onArchiver: (id: string) => Promise<void>;
}): React.JSX.Element {
  const [libelle, setLibelle] = useState(ligne.libelle);
  const [nombreEntree, setNombreEntree] = useState(ligne.nombreEntree?.toString() ?? "");
  const [etatEntree, setEtatEntree] = useState(ligne.etatEntree ?? "");
  const [nombreSortie, setNombreSortie] = useState(ligne.nombreSortie?.toString() ?? "");
  const [etatSortie, setEtatSortie] = useState(ligne.etatSortie ?? "");
  const [commentaire, setCommentaire] = useState(ligne.commentaire ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const champParams = {
    ligneExistante: true,
    entreeSignee,
    sortieSignee,
    champsIdentite: CHAMPS_IDENTITE_EQUIPEMENTS_DIVERS,
    classification: CLASSIFICATION_EQUIPEMENTS_DIVERS
  };
  const libelleEditable = champModifiable({ ...champParams, nomChamp: "libelle" });
  const nombreEntreeEditable = champModifiable({ ...champParams, nomChamp: "nombreEntree" });
  const etatEntreeEditable = champModifiable({ ...champParams, nomChamp: "etatEntree" });
  const nombreSortieEditable = champModifiable({ ...champParams, nomChamp: "nombreSortie" });
  const etatSortieEditable = champModifiable({ ...champParams, nomChamp: "etatSortie" });
  const commentaireEditable = champModifiable({ ...champParams, nomChamp: "commentaire" });

  async function handleSave(): Promise<void> {
    setError(null);
    setIsSaving(true);
    try {
      await onSave({
        id: ligne.id,
        libelle,
        ...(nombreEntree !== "" && { nombreEntree: Number(nombreEntree) }),
        ...(etatEntree && { etatEntree: etatEntree as EtatInventaire }),
        ...(nombreSortie !== "" && { nombreSortie: Number(nombreSortie) }),
        ...(etatSortie && { etatSortie: etatSortie as EtatInventaire }),
        ...(commentaire && { commentaire })
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer cet équipement");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleArchiver(): Promise<void> {
    setError(null);
    try {
      await onArchiver(ligne.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'archiver cet équipement");
    }
  }

  return (
    <tr className="border-b border-slate-100">
      <td className="py-1 pr-2">
        <input
          value={libelle}
          onChange={(e) => setLibelle(e.target.value)}
          readOnly={!libelleEditable}
          className={`w-32 rounded border px-2 py-1 text-sm ${
            libelleEditable ? "border-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
        />
      </td>
      <td className="py-1 pr-2">
        <input
          value={nombreEntree}
          onChange={(e) => setNombreEntree(e.target.value)}
          readOnly={!nombreEntreeEditable}
          className={`w-14 rounded border px-2 py-1 text-sm ${
            nombreEntreeEditable ? "border-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
        />
      </td>
      <td className="py-1 pr-2">
        <EtatInventaireSelect value={etatEntree} onChange={setEtatEntree} disabled={!etatEntreeEditable} />
      </td>
      <td className="py-1 pr-2">
        <input
          value={nombreSortie}
          onChange={(e) => setNombreSortie(e.target.value)}
          readOnly={!nombreSortieEditable}
          className={`w-14 rounded border px-2 py-1 text-sm ${
            nombreSortieEditable ? "border-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
        />
      </td>
      <td className="py-1 pr-2">
        <EtatInventaireSelect value={etatSortie} onChange={setEtatSortie} disabled={!etatSortieEditable} />
      </td>
      <td className="py-1 pr-2">
        <input
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
          readOnly={!commentaireEditable}
          className={`w-full rounded border px-2 py-1 text-sm ${
            commentaireEditable ? "border-slate-300" : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
        />
      </td>
      <td className="py-1 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving || !libelle.trim()}
          className="mr-2 text-xs text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
        >
          {isSaving ? "…" : "Enregistrer"}
        </button>
        {!entreeSignee && (
          <button
            type="button"
            onClick={() => void handleArchiver()}
            className="text-xs text-slate-500 hover:text-red-600"
          >
            Archiver
          </button>
        )}
        {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  );
}

function NouvelEquipementForm({
  onSave
}: {
  onSave: (ligne: LigneEquipementDiversInput) => Promise<void>;
}): React.JSX.Element {
  const [libelle, setLibelle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAjouter(): Promise<void> {
    if (!libelle.trim()) {
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await onSave({ libelle: libelle.trim() });
      setLibelle("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'ajouter cet équipement");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <input
          value={libelle}
          onChange={(e) => setLibelle(e.target.value)}
          placeholder="Nouvel équipement (ex. Store banne)"
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => void handleAjouter()}
          disabled={isSaving || !libelle.trim()}
          className="text-sm text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
        >
          {isSaving ? "Ajout…" : "+ Ajouter"}
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
