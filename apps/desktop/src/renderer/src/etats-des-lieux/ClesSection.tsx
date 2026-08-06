import { useState } from "react";
import { ARCHIVED_ROW_CLASSNAME, ArchiveBadge } from "../components/ArchiveFilter";
import type { LigneCle, LigneCleInput, TypeCle } from "./api";

const TYPES_CLE_FIXES: { valeur: TypeCle; label: string }[] = [
  { valeur: "immeuble", label: "Clés d'immeuble" },
  { valeur: "porte_entree", label: "Clés porte d'entrée" },
  { valeur: "boite_lettres", label: "Boîte aux lettres" },
  { valeur: "cave", label: "Clés cave" },
  { valeur: "badge_portail", label: "Badge ou clé portail" },
  { valeur: "parking", label: "Parking" }
];

// Clés : 6 types fixes du modèle réel, toujours affichés même sans ligne
// encore créée, + jusqu'à 2 lignes "autre" libres. Les lignes archivées
// (jamais détruites, voir EtatsDesLieuxService) ne sont visibles que
// lorsque le parent a demandé avecArchives — même mécanisme
// ArchiveBadge/ARCHIVED_ROW_CLASSNAME que le reste de l'app.
export function ClesSection({
  lignes,
  onSaveLigne,
  onArchiver
}: {
  lignes: LigneCle[];
  onSaveLigne: (ligne: LigneCleInput) => Promise<void>;
  onArchiver: (id: string) => Promise<void>;
}): React.JSX.Element {
  const actives = lignes.filter((l) => l.archivedAt === null);
  const archivees = lignes.filter((l) => l.archivedAt !== null);
  const autresActives = actives.filter((l) => l.typeCle === "autre");

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h4 className="mb-2 text-sm font-semibold text-slate-700">Clés</h4>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-1 pr-2 font-medium">Type</th>
            <th className="py-1 pr-2 font-medium">Nombre entrée</th>
            <th className="py-1 pr-2 font-medium">Nombre sortie</th>
            <th className="py-1 pr-2 font-medium">Commentaire</th>
            <th className="py-1 font-medium" />
          </tr>
        </thead>
        <tbody>
          {TYPES_CLE_FIXES.map(({ valeur, label }) => (
            <LigneCleRow
              key={valeur}
              typeCle={valeur}
              label={label}
              ligne={actives.find((l) => l.typeCle === valeur) ?? null}
              onSave={onSaveLigne}
              onArchiver={onArchiver}
            />
          ))}
          {autresActives.map((ligne) => (
            <LigneCleRow
              key={ligne.id}
              typeCle="autre"
              label={ligne.libelleAutre || "Autre"}
              ligne={ligne}
              onSave={onSaveLigne}
              onArchiver={onArchiver}
              avecLibelle
            />
          ))}
          {archivees.map((ligne) => (
            <tr key={ligne.id} className={`border-b border-slate-100 ${ARCHIVED_ROW_CLASSNAME}`}>
              <td className="py-1 pr-2">
                {ligne.typeCle === "autre" ? ligne.libelleAutre : TYPES_CLE_FIXES.find((t) => t.valeur === ligne.typeCle)?.label}
                <ArchiveBadge />
              </td>
              <td className="py-1 pr-2">{ligne.nombreEntree ?? "—"}</td>
              <td className="py-1 pr-2">{ligne.nombreSortie ?? "—"}</td>
              <td className="py-1 pr-2">{ligne.commentaire ?? "—"}</td>
              <td className="py-1" />
            </tr>
          ))}
        </tbody>
      </table>
      {autresActives.length < 2 && <NouvelleCleAutreForm onSave={onSaveLigne} />}
    </div>
  );
}

function LigneCleRow({
  typeCle,
  label,
  ligne,
  onSave,
  onArchiver,
  avecLibelle = false
}: {
  typeCle: TypeCle;
  label: string;
  ligne: LigneCle | null;
  onSave: (ligne: LigneCleInput) => Promise<void>;
  onArchiver: (id: string) => Promise<void>;
  avecLibelle?: boolean;
}): React.JSX.Element {
  const [libelleAutre, setLibelleAutre] = useState(ligne?.libelleAutre ?? (avecLibelle ? "" : label));
  const [nombreEntree, setNombreEntree] = useState(ligne?.nombreEntree?.toString() ?? "");
  const [nombreSortie, setNombreSortie] = useState(ligne?.nombreSortie?.toString() ?? "");
  const [commentaire, setCommentaire] = useState(ligne?.commentaire ?? "");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    try {
      await onSave({
        ...(ligne?.id && { id: ligne.id }),
        typeCle,
        ...(avecLibelle && { libelleAutre }),
        ...(nombreEntree !== "" && { nombreEntree: Number(nombreEntree) }),
        ...(nombreSortie !== "" && { nombreSortie: Number(nombreSortie) }),
        ...(commentaire && { commentaire })
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <tr className="border-b border-slate-100">
      <td className="py-1 pr-2">
        {avecLibelle ? (
          <input
            value={libelleAutre}
            onChange={(e) => setLibelleAutre(e.target.value)}
            className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        ) : (
          label
        )}
      </td>
      <td className="py-1 pr-2">
        <input
          value={nombreEntree}
          onChange={(e) => setNombreEntree(e.target.value)}
          className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="py-1 pr-2">
        <input
          value={nombreSortie}
          onChange={(e) => setNombreSortie(e.target.value)}
          className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
        />
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
            onClick={() => void onArchiver(ligne.id)}
            className="text-xs text-slate-500 hover:text-red-600"
          >
            Archiver
          </button>
        )}
      </td>
    </tr>
  );
}

function NouvelleCleAutreForm({ onSave }: { onSave: (ligne: LigneCleInput) => Promise<void> }): React.JSX.Element {
  const [libelleAutre, setLibelleAutre] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleAjouter(): Promise<void> {
    if (!libelleAutre.trim()) {
      return;
    }
    setIsSaving(true);
    try {
      await onSave({ typeCle: "autre", libelleAutre: libelleAutre.trim() });
      setLibelleAutre("");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        value={libelleAutre}
        onChange={(e) => setLibelleAutre(e.target.value)}
        placeholder="Autre clé (libellé)"
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <button
        type="button"
        onClick={() => void handleAjouter()}
        disabled={isSaving || !libelleAutre.trim()}
        className="text-sm text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
      >
        {isSaving ? "Ajout…" : "+ Ajouter"}
      </button>
    </div>
  );
}
