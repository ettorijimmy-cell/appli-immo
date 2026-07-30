import { calculerMontantRecuTotal } from "core";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArchiveToggle } from "../components/ArchiveFilter";
import { listBaux, type Bail } from "../locataires/api";
import {
  ajouterVersement,
  annulerVersement,
  archivePaiement,
  createPaiement,
  listPaiements,
  listVersements,
  type Paiement,
  type PaiementMode,
  type PaiementStatut,
  type PaiementType,
  type Versement
} from "./api";
import { chargerContexteBail, creerCachesContexteBail, type ContexteBail } from "./contexte-bail";

const PAIEMENT_TYPES: PaiementType[] = ["loyer", "charges", "depot_garantie"];
const PAIEMENT_MODES: PaiementMode[] = ["virement", "cheque", "especes", "caf"];
const STATUTS_FILTRABLES: Array<PaiementStatut | "tous"> = ["tous", "impaye", "partiel", "paye"];

interface PaiementAffichable extends Paiement {
  contexte: ContexteBail;
  montantRecu: string;
}

export function FinancesListView({
  bailIdFiltre = null
}: {
  // Deep-link depuis la palette de commandes (Module 8) : ne montre que les
  // paiements du bail choisi. L'utilisateur peut toujours revenir à la
  // liste complète (lien "Voir tous les paiements") — filtre purement côté
  // affichage, ne change rien à ce qui est chargé ni aux totaux ailleurs.
  bailIdFiltre?: string | null;
} = {}): React.JSX.Element {
  const [paiements, setPaiements] = useState<PaiementAffichable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState<PaiementStatut | "tous">("tous");
  const [groupement, setGroupement] = useState<"aucun" | "sci" | "echeance">("echeance");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filtreBailActif, setFiltreBailActif] = useState(bailIdFiltre);

  // Un paiement peut désormais recevoir plusieurs versements (docs/data-
  // dictionary.md, section "versements & remboursements") : le montant
  // "reçu" affiché ici est une somme, jamais un champ unique.
  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [bruts, tousLesVersements] = await Promise.all([listPaiements(), listVersements()]);
      const versementsActifsParPaiement = new Map<string, Versement[]>();
      for (const versement of tousLesVersements) {
        if (versement.archivedAt !== null) {
          continue;
        }
        const liste = versementsActifsParPaiement.get(versement.paiementId) ?? [];
        liste.push(versement);
        versementsActifsParPaiement.set(versement.paiementId, liste);
      }

      const caches = creerCachesContexteBail();
      const enrichis = await Promise.all(
        bruts.map(async (paiement) => ({
          ...paiement,
          contexte: await chargerContexteBail(paiement.bailId, caches),
          montantRecu: calculerMontantRecuTotal(versementsActifsParPaiement.get(paiement.id) ?? [])
        }))
      );
      setPaiements(enrichis);
      setError(null);
    } catch {
      setError("Impossible de charger les paiements");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleArchive(id: string): Promise<void> {
    await archivePaiement(id);
    await refresh();
  }

  const visibles = paiements
    .filter((p) => (showArchived ? true : p.archivedAt === null))
    .filter((p) => (filtreStatut === "tous" ? true : p.statut === filtreStatut))
    .filter((p) => (filtreBailActif ? p.bailId === filtreBailActif : true));

  const groupes = grouperPaiements(visibles, groupement);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Finances</h1>
        <div className="flex items-center gap-4">
          <ArchiveToggle show={showArchived} onToggle={() => setShowArchived((v) => !v)} />
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            {showForm ? "Annuler" : "Nouveau paiement"}
          </button>
        </div>
      </div>

      {filtreBailActif && (
        <div className="flex items-center gap-2 rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
          <span>Filtré sur un bail précis.</span>
          <button
            type="button"
            onClick={() => setFiltreBailActif(null)}
            className="font-medium underline hover:no-underline"
          >
            Voir tous les paiements
          </button>
        </div>
      )}

      <div className="flex items-center gap-6 text-sm">
        <label className="flex items-center gap-2">
          Statut
          <select
            id="finances-filtre-statut"
            value={filtreStatut}
            onChange={(e) => setFiltreStatut(e.target.value as PaiementStatut | "tous")}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {STATUTS_FILTRABLES.map((valeur) => (
              <option key={valeur} value={valeur}>
                {valeur}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Grouper par
          <select
            id="finances-groupement"
            value={groupement}
            onChange={(e) => setGroupement(e.target.value as "aucun" | "sci" | "echeance")}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="aucun">Aucun</option>
            <option value="sci">SCI</option>
            <option value="echeance">Échéance</option>
          </select>
        </label>
      </div>

      {showForm && (
        <NewPaiementForm
          onCreated={() => {
            setShowForm(false);
            void refresh();
          }}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : visibles.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun paiement pour le moment.</p>
      ) : (
        <div className="space-y-6">
          {groupes.map(([titre, lignes]) => (
            <div key={titre}>
              {groupement !== "aucun" && (
                <h2 className="mb-2 text-sm font-semibold text-slate-700">{titre}</h2>
              )}
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 font-medium">Échéance</th>
                    <th className="py-2 font-medium">SCI / Immeuble / Apt</th>
                    <th className="py-2 font-medium">Locataire(s)</th>
                    <th className="py-2 font-medium">Type</th>
                    <th className="py-2 font-medium">Montant</th>
                    <th className="py-2 font-medium">Statut</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((paiement) => (
                    <>
                      <tr
                        key={paiement.id}
                        className={`border-b border-slate-100 ${paiement.archivedAt !== null ? "opacity-60" : ""}`}
                      >
                        <td className="py-2">{paiement.dateEcheance}</td>
                        <td className="py-2">
                          {paiement.contexte.sciNom} / {paiement.contexte.immeubleNom} / n°
                          {paiement.contexte.appartementNumero}
                        </td>
                        <td className="py-2">{paiement.contexte.locatairesNoms || "—"}</td>
                        <td className="py-2">{paiement.type}</td>
                        <td className="py-2">
                          {paiement.montant} €
                          {paiement.montantRecu !== "0.00" ? ` (reçu ${paiement.montantRecu} €)` : ""}
                        </td>
                        <td className="py-2">{paiement.statut}</td>
                        <td className="py-2 text-right">
                          {paiement.archivedAt === null && (
                            <>
                              <button
                                type="button"
                                onClick={() => setExpandedId((v) => (v === paiement.id ? null : paiement.id))}
                                className="mr-3 text-sm text-indigo-700 hover:text-indigo-800"
                              >
                                {expandedId === paiement.id ? "Fermer" : "Versements"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleArchive(paiement.id);
                                }}
                                className="text-sm text-slate-500 hover:text-red-600"
                              >
                                Archiver
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {expandedId === paiement.id && (
                        <tr key={`${paiement.id}-versements`} className="border-b border-slate-100 bg-slate-50">
                          <td colSpan={7} className="p-3">
                            <VersementsPanel paiement={paiement} onChanged={() => void refresh()} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function grouperPaiements(
  paiements: PaiementAffichable[],
  groupement: "aucun" | "sci" | "echeance"
): Array<[string, PaiementAffichable[]]> {
  if (groupement === "aucun") {
    return [["Tous les paiements", paiements]];
  }
  const groupes = new Map<string, PaiementAffichable[]>();
  for (const paiement of paiements) {
    const cle = groupement === "sci" ? paiement.contexte.sciNom : paiement.dateEcheance;
    const liste = groupes.get(cle) ?? [];
    liste.push(paiement);
    groupes.set(cle, liste);
  }
  return [...groupes.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function NewPaiementForm({ onCreated }: { onCreated: () => void }): React.JSX.Element {
  const [bauxActifs, setBauxActifs] = useState<
    Array<{ bail: Bail; label: string }>
  >([]);
  const [bailId, setBailId] = useState("");
  const [type, setType] = useState<PaiementType>("loyer");
  const [montant, setMontant] = useState("");
  const [dateEcheance, setDateEcheance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      const tous = await listBaux();
      const actifs = tous.filter((b) => b.statut === "actif" || b.statut === "preavis");
      const caches = creerCachesContexteBail();
      const avecLabel = await Promise.all(
        actifs.map(async (bail) => {
          const contexte = await chargerContexteBail(bail.id, caches);
          return {
            bail,
            label: `${contexte.sciNom} / ${contexte.immeubleNom} / n°${contexte.appartementNumero} — ${contexte.locatairesNoms}`
          };
        })
      );
      setBauxActifs(avecLabel);
      if (avecLabel[0]) {
        setBailId(avecLabel[0].bail.id);
      }
    })();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (!bailId) {
        throw new Error("Aucun bail actif disponible");
      }
      await createPaiement({ bailId, type, montant, dateEcheance });
      setMontant("");
      setDateEcheance("");
      onCreated();
    } catch {
      setError("Impossible de créer le paiement");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-4 rounded-lg border border-slate-200 p-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="paiement-bail" className="text-sm font-medium text-slate-700">
            Bail
          </label>
          <select
            id="paiement-bail"
            value={bailId}
            onChange={(event) => setBailId(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {bauxActifs.map(({ bail, label }) => (
              <option key={bail.id} value={bail.id}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="paiement-type" className="text-sm font-medium text-slate-700">
            Type
          </label>
          <select
            id="paiement-type"
            value={type}
            onChange={(event) => setType(event.target.value as PaiementType)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {PAIEMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="paiement-montant" className="text-sm font-medium text-slate-700">
            Montant dû
          </label>
          <input
            id="paiement-montant"
            required
            value={montant}
            onChange={(event) => setMontant(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="paiement-echeance" className="text-sm font-medium text-slate-700">
            Échéance
          </label>
          <input
            id="paiement-echeance"
            type="date"
            required
            value={dateEcheance}
            onChange={(event) => setDateEcheance(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting || !bailId}
        className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
      >
        {isSubmitting ? "Création…" : "Créer le paiement"}
      </button>
    </form>
  );
}

// Un paiement peut recevoir plusieurs versements, y compris le même jour
// (confirmé en usage réel, docs/data-dictionary.md) : cette liste montre
// tous les versements actifs, permet d'en ajouter un nouveau (jamais
// n'écrase les précédents) et d'en annuler un précis (jamais une action
// groupée — décision D2).
function VersementsPanel({
  paiement,
  onChanged
}: {
  paiement: Paiement;
  onChanged: () => void;
}): React.JSX.Element {
  const [versements, setVersements] = useState<Versement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setVersements(await listVersements({ paiementId: paiement.id }));
    } finally {
      setIsLoading(false);
    }
  }, [paiement.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleAnnuler(versementId: string): Promise<void> {
    await annulerVersement(versementId);
    await refresh();
    onChanged();
  }

  const versementsActifs = versements.filter((v) => v.archivedAt === null);
  const versementsArchives = versements.filter((v) => v.archivedAt !== null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Versements</h3>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="text-sm text-indigo-700 hover:text-indigo-800"
        >
          {showForm ? "Annuler" : "+ Ajouter un versement"}
        </button>
      </div>

      {showForm && (
        <NewVersementForm
          paiement={paiement}
          onCreated={() => {
            setShowForm(false);
            void refresh();
            onChanged();
          }}
        />
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : versements.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun versement pour le moment.</p>
      ) : (
        <table className="w-full max-w-lg text-left text-sm">
          <tbody>
            {versementsActifs.map((versement) => (
              <tr key={versement.id} className="border-b border-slate-100">
                <td className="py-1">{versement.dateVersement}</td>
                <td className="py-1">{versement.montant} €</td>
                <td className="py-1">{versement.mode}</td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      void handleAnnuler(versement.id);
                    }}
                    className="text-xs text-slate-500 hover:text-red-600"
                  >
                    Annuler
                  </button>
                </td>
              </tr>
            ))}
            {versementsArchives.map((versement) => (
              <tr key={versement.id} className="border-b border-slate-100 opacity-50">
                <td className="py-1">{versement.dateVersement}</td>
                <td className="py-1">{versement.montant} €</td>
                <td className="py-1">{versement.mode}</td>
                <td className="py-1 text-right text-xs text-slate-400">Annulé</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NewVersementForm({
  paiement,
  onCreated
}: {
  paiement: Paiement;
  onCreated: () => void;
}): React.JSX.Element {
  const [montant, setMontant] = useState(paiement.montant);
  const [mode, setMode] = useState<PaiementMode>("virement");
  const [dateVersement, setDateVersement] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await ajouterVersement({ paiementId: paiement.id, montant, mode, dateVersement });
      onCreated();
    } catch {
      setError("Impossible d'ajouter le versement");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="flex items-end gap-3 rounded-md border border-slate-200 bg-white p-3"
    >
      <div className="space-y-1">
        <label htmlFor="versement-montant" className="text-xs font-medium text-slate-700">
          Montant
        </label>
        <input
          id="versement-montant"
          value={montant}
          onChange={(e) => setMontant(e.target.value)}
          className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="versement-date" className="text-xs font-medium text-slate-700">
          Date
        </label>
        <input
          id="versement-date"
          type="date"
          value={dateVersement}
          onChange={(e) => setDateVersement(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="versement-mode" className="text-xs font-medium text-slate-700">
          Mode
        </label>
        <select
          id="versement-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as PaiementMode)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {PAIEMENT_MODES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
      >
        {isSubmitting ? "Ajout…" : "Ajouter"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
