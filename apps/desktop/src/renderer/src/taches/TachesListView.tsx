import { useCallback, useEffect, useState } from "react";
import { obtenirStatutGmail } from "../gmail/api";
import { ApiError } from "../lib/authenticated-fetch";
import {
  appliquerRevisionTache,
  envoyerNotificationTache,
  genererDocumentQuittance,
  lireMetadataNotification,
  lireMetadataRevisionLoyer,
  lireMotifNotificationIndisponible,
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
  // Chargé une seule fois à l'ouverture de l'écran (pas de polling, même
  // principe que ConnexionGmailView) — sert uniquement à désactiver le
  // bouton "Envoyer" avec une infobulle explicite si Gmail n'est pas
  // connecté ; null tant que non résolu (traité comme non connecté).
  const [gmailConnecte, setGmailConnecte] = useState<boolean | null>(null);

  useEffect(() => {
    obtenirStatutGmail()
      .then((statut) => setGmailConnecte(statut.connecte))
      .catch(() => setGmailConnecte(false));
  }, []);

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
            <TacheItem
              key={tache.id}
              tache={tache}
              libelle={libelles.get(tache.id) ?? "…"}
              onChanged={refresh}
              gmailConnecte={gmailConnecte ?? false}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TacheItem({
  tache,
  libelle,
  onChanged,
  gmailConnecte
}: {
  tache: Tache;
  libelle: string;
  onChanged: () => Promise<void>;
  gmailConnecte: boolean;
}): React.JSX.Element {
  const metadataRevision = tache.type === "revision_loyer" ? lireMetadataRevisionLoyer(tache.metadata) : null;
  const metadataNotification = lireMetadataNotification(tache.metadata);
  const motifNotificationIndisponible = lireMotifNotificationIndisponible(tache.metadata);
  const [loyerAjuste, setLoyerAjuste] = useState(metadataRevision?.loyerPropose ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingDocument, setIsGeneratingDocument] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);

  async function handleMarquerFait(): Promise<void> {
    await marquerTacheFait(tache.id);
    await onChanged();
  }

  // Envoie la notification déjà résolue en metadata via Gmail et marque la
  // tâche fait (voir TachesService.envoyerNotification) — jamais fait sur
  // un échec d'envoi, l'exception (Gmail non connecté, jeton révoqué…)
  // reste affichée sans changer le statut.
  async function handleEnvoyerNotification(): Promise<void> {
    setIsSendingNotification(true);
    setNotificationError(null);
    try {
      await envoyerNotificationTache(tache.id);
      await onChanged();
    } catch (err) {
      setNotificationError(err instanceof ApiError ? err.message : "Impossible d'envoyer la notification");
      setIsSendingNotification(false);
    }
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

  // Téléchargement seul, aucun changement de statut (contrairement à
  // appliquerRevision) : la génération du document n'est pas une action
  // métier au sens de TachesService, "Marquer fait" reste le geste manuel
  // qui clôt la tâche une fois la quittance effectivement transmise (envoi
  // Gmail hors périmètre de cette étape, docs/backlog.md).
  async function handleGenererQuittance(): Promise<void> {
    if (!tache.paiementId) return;
    setIsGeneratingDocument(true);
    setDocumentError(null);
    try {
      await genererDocumentQuittance(tache.paiementId);
    } catch {
      setDocumentError("Impossible de générer la quittance");
    } finally {
      setIsGeneratingDocument(false);
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
        (tache.statut === "a_faire" || tache.statut === "en_cours") && (
          <div className="flex items-center gap-3">
            {tache.type === "quittance_mensuelle" && tache.paiementId && (
              <button
                type="button"
                onClick={() => {
                  void handleGenererQuittance();
                }}
                disabled={isGeneratingDocument}
                className="text-sm text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
              >
                {isGeneratingDocument ? "Génération…" : "Générer la quittance"}
              </button>
            )}
            {documentError && (
              <span role="alert" className="text-xs text-red-600">
                {documentError}
              </span>
            )}
            {metadataNotification ? (
              // Notification déjà résolue (objet/corps) : l'envoi via Gmail
              // remplace "Marquer fait", qui n'est plus atteignable ici —
              // c'est envoyerNotification() qui pose le statut fait, jamais
              // un clic manuel sans envoi réel. "Marquer annulée" reste
              // disponible en secours.
              <button
                type="button"
                onClick={() => {
                  void handleEnvoyerNotification();
                }}
                disabled={isSendingNotification || !gmailConnecte}
                title={gmailConnecte ? undefined : "Connectez Gmail dans Paramètres pour envoyer cette notification"}
                className="text-sm text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
              >
                {isSendingNotification ? "Envoi…" : "Envoyer"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void handleMarquerFait();
                }}
                className="text-sm text-indigo-700 hover:text-indigo-800"
              >
                Marquer fait
              </button>
            )}
            {notificationError && (
              <span role="alert" className="text-xs text-red-600">
                {notificationError}
              </span>
            )}
            {!metadataNotification && motifNotificationIndisponible && (
              <span className="text-xs text-amber-600">Notification indisponible : {motifNotificationIndisponible}</span>
            )}
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
