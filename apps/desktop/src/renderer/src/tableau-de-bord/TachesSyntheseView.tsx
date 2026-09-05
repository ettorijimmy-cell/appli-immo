import { useEffect, useState } from "react";
import { creerCacheLibellesTaches, resoudreLibelleTache } from "../taches/libelle-tache";
import { listTaches, type Tache } from "../taches/api";

const NOMBRE_PREVISUALISE = 5;

interface TacheApercu {
  id: string;
  libelle: string;
  dateEcheance: string | null;
}

// Carte de synthèse en lecture seule (Module Tâches, Étape 4, 2026-09-05) —
// remplace la liste complète TachesListView sur le tableau de bord,
// désormais déplacée vers sa propre page (/taches). Aucune action ici :
// toutes les actions (Marquer fait, Envoyer, etc.) vivent sur la page
// dédiée, même principe que CartesSyntheseView pour les autres compteurs.
export function TachesSyntheseView(): React.JSX.Element {
  const [taches, setTaches] = useState<Tache[] | null>(null);
  const [apercu, setApercu] = useState<TacheApercu[]>([]);

  useEffect(() => {
    void (async () => {
      const [aFaire, enCours] = await Promise.all([
        listTaches({ statut: "a_faire" }),
        listTaches({ statut: "en_cours" })
      ]);
      const actives = [...aFaire, ...enCours];
      setTaches(actives);

      const triees = [...actives].sort((a, b) => {
        if (!a.dateEcheance) return 1;
        if (!b.dateEcheance) return -1;
        return a.dateEcheance.localeCompare(b.dateEcheance);
      });
      const cache = creerCacheLibellesTaches();
      const prochaines = await Promise.all(
        triees.slice(0, NOMBRE_PREVISUALISE).map(async (tache) => ({
          id: tache.id,
          libelle: await resoudreLibelleTache(tache, cache),
          dateEcheance: tache.dateEcheance
        }))
      );
      setApercu(prochaines);
    })();
  }, []);

  if (!taches) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase text-slate-500">Tâches à faire</p>
        <p className="text-2xl font-semibold text-slate-900">{taches.length}</p>
      </div>
      {apercu.length > 0 && (
        <ul className="mt-3 space-y-1">
          {apercu.map((tache) => (
            <li key={tache.id} className="flex items-center justify-between gap-2 text-sm text-slate-600">
              <span className="truncate">{tache.libelle}</span>
              {tache.dateEcheance && <span className="shrink-0 text-xs text-slate-400">{tache.dateEcheance}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
