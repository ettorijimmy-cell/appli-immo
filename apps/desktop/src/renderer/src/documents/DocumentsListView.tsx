import { useCallback, useEffect, useState } from "react";
import { ArchiveToggle } from "../components/ArchiveFilter";
import { archiveDocument, listDocuments, ouvrirDocument, type DocumentCategorie, type DocumentMetier, type DocumentStatut } from "./api";
import { creerCacheLibellesEntites, resoudreLibelleEntite } from "./libelle-entite";
import { CATEGORIE_LABELS, ENTITE_TYPE_LABELS, STATUT_BADGE_CLASSNAMES, STATUT_LABELS } from "./labels";

const CATEGORIES: DocumentCategorie[] = [
  "bail",
  "assurance",
  "etat_des_lieux",
  "diagnostic",
  "dpe",
  "piece_identite",
  "rib",
  "caf",
  "quittance",
  "courrier",
  "photo"
];
const STATUTS: DocumentStatut[] = ["valide", "expire", "archive"];

interface DocumentAffichable extends DocumentMetier {
  entiteLibelle: string;
}

export function DocumentsListView(): React.JSX.Element {
  const [documents, setDocuments] = useState<DocumentAffichable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [filtreCategorie, setFiltreCategorie] = useState<DocumentCategorie | "toutes">("toutes");
  const [filtreStatut, setFiltreStatut] = useState<DocumentStatut | "tous">("tous");
  const [recherche, setRecherche] = useState("");

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const bruts = await listDocuments({ avecArchives: true });
      const cache = creerCacheLibellesEntites();
      const enrichis = await Promise.all(
        bruts.map(async (document) => ({
          ...document,
          entiteLibelle: await resoudreLibelleEntite(document.entiteType, document.entiteId, cache)
        }))
      );
      setDocuments(enrichis);
      setError(null);
    } catch {
      setError("Impossible de charger les documents");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleArchive(id: string): Promise<void> {
    await archiveDocument(id);
    await refresh();
  }

  const rechercheNormalisee = recherche.trim().toLowerCase();
  const visibles = documents
    .filter((document) => (showArchived ? true : document.statut !== "archive"))
    .filter((document) => (filtreCategorie === "toutes" ? true : document.categorie === filtreCategorie))
    .filter((document) => (filtreStatut === "tous" ? true : document.statut === filtreStatut))
    .filter((document) => (rechercheNormalisee ? document.nomFichier.toLowerCase().includes(rechercheNormalisee) : true));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Documents</h1>
        <ArchiveToggle show={showArchived} onToggle={() => setShowArchived((v) => !v)} />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          Catégorie
          <select
            value={filtreCategorie}
            onChange={(e) => setFiltreCategorie(e.target.value as DocumentCategorie | "toutes")}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="toutes">Toutes</option>
            {CATEGORIES.map((valeur) => (
              <option key={valeur} value={valeur}>
                {CATEGORIE_LABELS[valeur]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Statut
          <select
            value={filtreStatut}
            onChange={(e) => setFiltreStatut(e.target.value as DocumentStatut | "tous")}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="tous">Tous</option>
            {STATUTS.map((valeur) => (
              <option key={valeur} value={valeur}>
                {STATUT_LABELS[valeur]}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          placeholder="Rechercher un nom de fichier…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : visibles.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun document.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 font-medium">Fichier</th>
              <th className="py-2 font-medium">Catégorie</th>
              <th className="py-2 font-medium">Rattaché à</th>
              <th className="py-2 font-medium">Statut</th>
              <th className="py-2 font-medium">Expiration</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {visibles.map((document) => (
              <tr key={document.id} className="border-b border-slate-100">
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => {
                      void ouvrirDocument(document.id);
                    }}
                    className="text-indigo-700 hover:text-indigo-800 hover:underline"
                  >
                    {document.nomFichier}
                  </button>
                </td>
                <td className="py-2">{CATEGORIE_LABELS[document.categorie]}</td>
                <td className="py-2">
                  {ENTITE_TYPE_LABELS[document.entiteType]} — {document.entiteLibelle}
                </td>
                <td className="py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BADGE_CLASSNAMES[document.statut]}`}
                  >
                    {STATUT_LABELS[document.statut]}
                  </span>
                </td>
                <td className="py-2">{document.dateExpiration ?? "—"}</td>
                <td className="py-2 text-right">
                  {document.statut !== "archive" && (
                    <button
                      type="button"
                      onClick={() => {
                        void handleArchive(document.id);
                      }}
                      className="text-sm text-slate-500 hover:text-red-600"
                    >
                      Archiver
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
