import { useEffect, useState } from "react";
import type { DocumentCategorie } from "../documents/api";
import { CATEGORIE_LABELS } from "../documents/labels";
import { chargerContexteBail, creerCachesContexteBail } from "../finances/contexte-bail";
import { getGarant, getLocataire } from "../locataires/api";
import { getAppartement, getBien, libelleBien } from "../patrimoine/api";
import { getChecklistDocumentaire, type ChecklistDocumentaire } from "./api";

// Calculée à la volée côté backend, jamais stockée (même philosophie que
// RemboursementsEnAttenteView) — ne montre que ce qui manque, pas un état
// exhaustif de tout ce qui va bien (docs/backlog.md, checklist
// documentaire). Un diagnostic expiré compte comme manquant ici même s'il
// reste "présent" pour l'annexe d'un bail déjà signé — deux besoins
// différents, pas une incohérence.
export function ChecklistDocumentaireCard(): React.JSX.Element | null {
  const [checklist, setChecklist] = useState<ChecklistDocumentaire | null>(null);
  const [libellesAppartements, setLibellesAppartements] = useState<Map<string, string>>(new Map());
  const [libellesLocataires, setLibellesLocataires] = useState<Map<string, string>>(new Map());
  const [libellesGarants, setLibellesGarants] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    void (async () => {
      const resultat = await getChecklistDocumentaire();
      setChecklist(resultat);

      const libellesAppart = new Map<string, string>();
      await Promise.all(
        resultat.appartements.map(async (a) => {
          try {
            if (!a.bienId) {
              libellesAppart.set(a.appartementId, "Appartement introuvable");
              return;
            }
            const [appartement, bien] = await Promise.all([getAppartement(a.appartementId), getBien(a.bienId)]);
            libellesAppart.set(a.appartementId, `${libelleBien(bien)} — n°${appartement.numero}`);
          } catch {
            libellesAppart.set(a.appartementId, "Appartement introuvable");
          }
        })
      );
      setLibellesAppartements(libellesAppart);

      const caches = creerCachesContexteBail();
      const libellesLoc = new Map<string, string>();
      await Promise.all(
        resultat.locataires.map(async (l) => {
          try {
            const [locataire, contexte] = await Promise.all([
              getLocataire(l.locataireId),
              chargerContexteBail(l.bailId, caches)
            ]);
            libellesLoc.set(
              l.locataireId,
              `${locataire.prenom} ${locataire.nom} — ${contexte.bienNom} n°${contexte.appartementNumero}`
            );
          } catch {
            libellesLoc.set(l.locataireId, "Locataire introuvable");
          }
        })
      );
      setLibellesLocataires(libellesLoc);

      const libellesGar = new Map<string, string>();
      await Promise.all(
        resultat.garants.map(async (g) => {
          try {
            const [garant, contexte] = await Promise.all([
              getGarant(g.garantId),
              chargerContexteBail(g.bailId, caches)
            ]);
            libellesGar.set(
              g.garantId,
              `${garant.prenom} ${garant.nom} — ${contexte.bienNom} n°${contexte.appartementNumero}`
            );
          } catch {
            libellesGar.set(g.garantId, "Garant introuvable");
          }
        })
      );
      setLibellesGarants(libellesGar);
    })();
  }, []);

  if (
    !checklist ||
    (checklist.appartements.length === 0 && checklist.locataires.length === 0 && checklist.garants.length === 0)
  ) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold text-amber-900">Checklist documentaire</h2>

      {checklist.appartements.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Appartements ({checklist.appartements.length})
          </h3>
          <ul className="space-y-1 text-sm text-amber-900">
            {checklist.appartements.map((a) => (
              <li key={a.appartementId}>
                {libellesAppartements.get(a.appartementId) ?? "…"} :{" "}
                {a.categoriesManquantes
                  .map((c) => CATEGORIE_LABELS[c as DocumentCategorie] ?? c)
                  .join(", ")}{" "}
                manquant{a.categoriesManquantes.length > 1 ? "s" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {checklist.locataires.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Locataires ({checklist.locataires.length})
          </h3>
          <ul className="space-y-1 text-sm text-amber-900">
            {checklist.locataires.map((l) => (
              <li key={l.locataireId}>{libellesLocataires.get(l.locataireId) ?? "…"} : pièce d'identité manquante</li>
            ))}
          </ul>
        </div>
      )}

      {checklist.garants.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Garants ({checklist.garants.length})
          </h3>
          <ul className="space-y-1 text-sm text-amber-900">
            {checklist.garants.map((g) => (
              <li key={g.garantId}>{libellesGarants.get(g.garantId) ?? "…"} : pièce d'identité manquante</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
