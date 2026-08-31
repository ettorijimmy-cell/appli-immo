import { useCallback, useEffect, useState } from "react";
import {
  appliquerRevisionTache,
  lireMetadataRevisionLoyer,
  listTaches,
  marquerTacheAnnulee,
  marquerTacheFait,
  type Tache,
  type TacheStatut,
  type TacheType
} from "./api";
import { creerCacheLibellesTaches, resoudreLibelleTache } from "./libelle-tache";

const TYPE_LABELS: Record<TacheType, string> = {
  impaye: "Impayé",
  entretien_equipement: "Entretien d'équipement",
  document_expire: "Document expiré",
  quittance_mensuelle: "Quittance mensuelle",
  revision_loyer: "Révision de loyer",
  autre: "Autre"
};

const STATUT_OPTIONS: { value: TacheStatut | ""; label: string }[] = [
  { value: "a_faire", label: "À faire" },
  { value: "en_cours", label: "En cours" },
  { value: "fait", label: "Fait" },
  { value: "annulee", label: "Annulée" },
  { value: "", label: "Tous les statuts" }
];

// Vue minimale pour l'Étape 1 du Module Tâches (docs/backlog.md) : les
// tâches de cette étape sont toutes générées par TachesJobService, aucun
// formulaire de création manuelle ici (pas de create() exposé côté
// backend). Montée sur le Tableau de bord, juste après AlertesListView —
// même emplacement logique (l'action qui découle du constat), et
// docs/app-spec.md section 3bis interdit d'ajouter une 7e entrée à la
// navigation principale sans fusionner deux entrées existantes.
export function TachesListView(): React.JSX.Element {
  const [taches, setTaches] = useState<Tache[]>([]);
  const [libelles, setLibelles] = useState<Map<string, string>>(new Map());
  const [statut, setStatut] = useState<TacheStatut | "">("a_faire");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Compteur toujours visible, indépendant du filtre sélectionné : le
  // filtre par défaut ("À faire") masque les tâches en_cours — une
  // révision appliquée (appliquerRevision) mais dont la notification n'a
  // pas encore été envoyée (Gmail, étape 3/4) ne doit jamais se perdre
  // silencieusement hors de vue en attendant.
  const [nombreEnCours, setNombreEnCours] = useState(0);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const filtres = statut ? { statut } : {};
      const [lignes, enCours] = await Promise.all([listTaches(filtres), listTaches({ statut: "en_cours" })]);
      setTaches(lignes);
      setNombreEnCours(enCours.length);
      setError(null);

      const cache = creerCacheLibellesTaches();
      const entrees = await Promise.all(
        lignes.map(async (tache) => [tache.id, await resoudreLibelleTache(tache, cache)] as const)
      );
      setLibelles(new Map(entrees));
    } catch {
      setError("Impossible de charger les tâches");
    } finally {
      setIsLoading(false);
    }
  }, [statut]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Tâches</h2>
        <select
          value={statut}
          onChange={(e) => setStatut(e.target.value as TacheStatut | "")}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {STATUT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {nombreEnCours > 0 && statut !== "en_cours" && (
        <button
          type="button"
          onClick={() => setStatut("en_cours")}
          className="w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-left text-xs text-amber-800 hover:bg-amber-100"
        >
          {nombreEnCours} tâche{nombreEnCours > 1 ? "s" : ""} en cours — appliquée{nombreEnCours > 1 ? "s" : ""}{" "}
          financièrement, notification par email pas encore envoyée. Voir.
        </button>
      )}
      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : taches.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune tâche.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {taches.map((tache) => (
            <TacheItem key={tache.id} tache={tache} libelle={libelles.get(tache.id) ?? "…"} onChanged={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TacheItem({
  tache,
  libelle,
  onChanged
}: {
  tache: Tache;
  libelle: string;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const metadataRevision = tache.type === "revision_loyer" ? lireMetadataRevisionLoyer(tache.metadata) : null;
  const [loyerAjuste, setLoyerAjuste] = useState(metadataRevision?.loyerPropose ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMarquerFait(): Promise<void> {
    await marquerTacheFait(tache.id);
    await onChanged();
  }

  async function handleMarquerAnnulee(): Promise<void> {
    await marquerTacheAnnulee(tache.id);
    await onChanged();
  }

  async function handleAppliquerRevision(): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    try {
      await appliquerRevisionTache(tache.id, loyerAjuste);
      await onChanged();
    } catch {
      setError("Impossible d'appliquer la révision");
      setIsSubmitting(false);
    }
  }

  return (
    <li className="flex items-center justify-between py-2">
      <div>
        <span className="mr-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
          {TYPE_LABELS[tache.type]}
        </span>
        {libelle}
        {tache.dateEcheance && <span className="ml-2 text-xs text-slate-400">échéance {tache.dateEcheance}</span>}
      </div>

      {tache.type === "revision_loyer" && tache.statut === "a_faire" && metadataRevision ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Loyer actuel {metadataRevision.loyerActuel} €</span>
          <input
            value={loyerAjuste}
            onChange={(event) => setLoyerAjuste(event.target.value)}
            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
            aria-label="Nouveau loyer proposé"
          />
          <button
            type="button"
            onClick={() => {
              void handleAppliquerRevision();
            }}
            disabled={isSubmitting}
            className="text-sm text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
          >
            Appliquer la révision
          </button>
          {error && (
            <span role="alert" className="text-xs text-red-600">
              {error}
            </span>
          )}
        </div>
      ) : (
        (tache.statut === "a_faire" || tache.statut === "en_cours") &&
        tache.type !== "revision_loyer" && (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                void handleMarquerFait();
              }}
              className="text-sm text-indigo-700 hover:text-indigo-800"
            >
              Marquer fait
            </button>
            <button
              type="button"
              onClick={() => {
                void handleMarquerAnnulee();
              }}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Marquer annulée
            </button>
          </div>
        )
      )}
    </li>
  );
}
