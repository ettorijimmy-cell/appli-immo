import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArchiveToggle } from "../components/ArchiveFilter";
import { listBaux, type Bail } from "../locataires/api";
import { chargerContexteBail, creerCachesContexteBail, type ContexteBail } from "./contexte-bail";
import {
  annulerEnregistrementPaiement,
  archivePaiement,
  createPaiement,
  enregistrerPaiement,
  listPaiements,
  type Paiement,
  type PaiementMode,
  type PaiementStatut,
  type PaiementType
} from "./api";

const PAIEMENT_TYPES: PaiementType[] = ["loyer", "charges", "depot_garantie"];
const PAIEMENT_MODES: PaiementMode[] = ["virement", "cheque", "especes", "caf"];
const STATUTS_FILTRABLES: Array<PaiementStatut | "tous"> = ["tous", "impaye", "partiel", "paye"];

interface PaiementAffichable extends Paiement {
  contexte: ContexteBail;
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filtreBailActif, setFiltreBailActif] = useState(bailIdFiltre);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const bruts = await listPaiements();
      const caches = creerCachesContexteBail();
      const enrichis = await Promise.all(
        bruts.map(async (paiement) => ({
          ...paiement,
          contexte: await chargerContexteBail(paiement.bailId, caches)
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
                  {lignes.map((paiement) =>
                    editingId === paiement.id ? (
                      <EnregistrerPaiementRow
                        key={paiement.id}
                        paiement={paiement}
                        onSaved={() => {
                          setEditingId(null);
                          void refresh();
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
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
                          {paiement.montant} €{paiement.montantPaye ? ` (reçu ${paiement.montantPaye} €)` : ""}
                        </td>
                        <td className="py-2">{paiement.statut}</td>
                        <td className="py-2 text-right">
                          {paiement.archivedAt === null && (
                            <>
                              {paiement.statut !== "paye" && (
                                <button
                                  type="button"
                                  onClick={() => setEditingId(paiement.id)}
                                  className="mr-3 text-sm text-indigo-700 hover:text-indigo-800"
                                >
                                  Enregistrer
                                </button>
                              )}
                              {paiement.montantPaye !== null && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    void (async () => {
                                      await annulerEnregistrementPaiement(paiement.id);
                                      await refresh();
                                    })();
                                  }}
                                  className="mr-3 text-sm text-slate-500 hover:text-slate-700"
                                >
                                  Annuler l'enregistrement
                                </button>
                              )}
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
                    )
                  )}
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

function EnregistrerPaiementRow({
  paiement,
  onSaved,
  onCancel
}: {
  paiement: Paiement;
  onSaved: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [montantPaye, setMontantPaye] = useState(paiement.montant);
  const [mode, setMode] = useState<PaiementMode>("virement");
  const [datePaiement, setDatePaiement] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSave(): Promise<void> {
    setError(null);
    setIsSubmitting(true);
    try {
      await enregistrerPaiement(paiement.id, { montantPaye, mode, datePaiement });
      onSaved();
    } catch {
      setError("Impossible d'enregistrer le paiement");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <tr className="border-b border-slate-100">
      <td className="py-2" colSpan={2}>
        <input
          id="finances-enregistrer-montant"
          value={montantPaye}
          onChange={(e) => setMontantPaye(e.target.value)}
          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="py-2">
        <input
          id="finances-enregistrer-date"
          type="date"
          value={datePaiement}
          onChange={(e) => setDatePaiement(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="py-2" colSpan={2}>
        <select
          id="finances-enregistrer-mode"
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
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </td>
      <td className="py-2 text-right" colSpan={2}>
        <button
          type="button"
          onClick={() => {
            void handleSave();
          }}
          disabled={isSubmitting}
          className="mr-3 text-sm text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
        >
          {isSubmitting ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700">
          Annuler
        </button>
      </td>
    </tr>
  );
}
