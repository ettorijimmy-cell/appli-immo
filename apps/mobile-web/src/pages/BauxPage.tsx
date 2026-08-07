import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { chargerContexteBail, listBaux, type Bail, type ContexteBail } from "../api/patrimoine";

interface BailAffichable {
  bail: Bail;
  contexte: ContexteBail;
}

// Écran d'accueil du parcours mobile : sélection du bail à traiter.
// Liste plate + recherche texte (pas de navigation hiérarchique SCI →
// immeuble → appartement) — le parc reste petit (~20 logements, voir
// CLAUDE.md), une recherche directe est plus rapide en visite.
export function BauxPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [items, setItems] = useState<BailAffichable[]>([]);
  const [recherche, setRecherche] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const baux = await listBaux();
        const nonArchives = baux.filter((b) => b.archivedAt === null);
        const enrichis = await Promise.all(
          nonArchives.map(async (bail) => ({ bail, contexte: await chargerContexteBail(bail) }))
        );
        setItems(enrichis);
        setError(null);
      } catch {
        setError("Impossible de charger les baux");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const filtres = items.filter(({ contexte }) => {
    const texte = `${contexte.sciNom} ${contexte.immeubleNom} ${contexte.appartementNumero} ${contexte.locatairesNoms}`.toLowerCase();
    return texte.includes(recherche.toLowerCase());
  });

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 py-4">
      <h1 className="mb-4 text-lg font-semibold text-slate-900">État des lieux — choisir un bail</h1>

      <input
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        placeholder="Rechercher (locataire, adresse…)"
        className="mb-4 w-full rounded-md border border-slate-300 px-3 py-3 text-base"
      />

      {isLoading && <p className="text-sm text-slate-500">Chargement…</p>}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {filtres.map(({ bail, contexte }) => (
          <li key={bail.id}>
            <button
              type="button"
              onClick={() => navigate(`/bail/${bail.id}`)}
              className="w-full rounded-md border border-slate-200 px-4 py-3 text-left"
            >
              <p className="text-base font-medium text-slate-800">
                {contexte.sciNom} / {contexte.immeubleNom} / n°{contexte.appartementNumero}
              </p>
              <p className="text-sm text-slate-500">
                {contexte.locatairesNoms || "—"} · {bail.statut}
              </p>
            </button>
          </li>
        ))}
        {!isLoading && filtres.length === 0 && (
          <p className="text-sm text-slate-500">Aucun bail ne correspond.</p>
        )}
      </ul>
    </div>
  );
}
