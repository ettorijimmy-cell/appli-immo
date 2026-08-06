import { useState } from "react";
import { ARCHIVED_ROW_CLASSNAME, ArchiveBadge } from "../components/ArchiveFilter";
import type { EtatInventaire, LigneEquipementDivers, LigneEquipementDiversInput } from "./api";

const ETATS_INVENTAIRE: { valeur: EtatInventaire; label: string }[] = [
  { valeur: "bon", label: "Bon" },
  { valeur: "dusage", label: "D'usage" },
  { valeur: "mauvais", label: "Mauvais" }
];

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

// Liste extensible, libellé saisi librement — section "ÉQUIPEMENTS
// DIVERS" du modèle réel, applicable à tout bail (vide ou meublé),
// distincte de l'inventaire meublé (catalogue fixe).
export function EquipementsDiversSection({
  lignes,
  onSaveLigne,
  onArchiver
}: {
  lignes: LigneEquipementDivers[];
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
            <LigneEquipementRow key={ligne.id} ligne={ligne} onSave={onSaveLigne} onArchiver={onArchiver} />
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
      <NouvelEquipementForm onSave={onSaveLigne} />
    </div>
  );
}

function LigneEquipementRow({
  ligne,
  onSave,
  onArchiver
}: {
  ligne: LigneEquipementDivers;
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

  async function handleSave(): Promise<void> {
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
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <tr className="border-b border-slate-100">
      <td className="py-1 pr-2">
        <input
          value={libelle}
          onChange={(e) => setLibelle(e.target.value)}
          className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
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
          disabled={isSaving || !libelle.trim()}
          className="mr-2 text-xs text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
        >
          {isSaving ? "…" : "Enregistrer"}
        </button>
        <button
          type="button"
          onClick={() => void onArchiver(ligne.id)}
          className="text-xs text-slate-500 hover:text-red-600"
        >
          Archiver
        </button>
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

  async function handleAjouter(): Promise<void> {
    if (!libelle.trim()) {
      return;
    }
    setIsSaving(true);
    try {
      await onSave({ libelle: libelle.trim() });
      setLibelle("");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2">
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
  );
}
