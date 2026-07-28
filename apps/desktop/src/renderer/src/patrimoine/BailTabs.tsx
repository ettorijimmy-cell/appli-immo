import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ARCHIVED_ROW_CLASSNAME, ArchiveBadge, ArchiveToggle } from "../components/ArchiveFilter";
import { ApiError } from "../lib/authenticated-fetch";
import {
  activerBail,
  archiveBailLocataire,
  archiveGarant,
  createBail,
  createBailLocataire,
  createGarant,
  getLocataire,
  listBailLocataires,
  listBaux,
  listGarants,
  listLocataires,
  resilierBail,
  updateBail,
  type Bail,
  type BailLocataire,
  type BailLocataireRole,
  type BailTypeBail,
  type Garant,
  type GarantTypeGarantie,
  type Locataire
} from "../locataires/api";
import type { Appartement } from "./api";

const BAIL_TYPES: BailTypeBail[] = ["vide", "meuble"];
const GARANT_TYPES: GarantTypeGarantie[] = ["personne_physique", "garantie_visale", "autre"];
const ROLES: BailLocataireRole[] = ["titulaire", "colocataire"];

const STATUTS_BAIL_EN_COURS = new Set(["brouillon", "actif", "preavis"]);

export function BailActuelTab({ appartement }: { appartement: Appartement }): React.JSX.Element {
  const [baux, setBaux] = useState<Bail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBaux(await listBaux({ appartementId: appartement.id }));
      setError(null);
    } catch {
      setError("Impossible de charger le bail");
    }
  }, [appartement.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }

  const bailActuel = baux.find((bail) => STATUTS_BAIL_EN_COURS.has(bail.statut)) ?? null;

  if (!bailActuel) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">Aucun bail en cours.</p>
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            {showForm ? "Annuler" : "Nouveau bail"}
          </button>
        </div>

        {showForm && (
          <NewBailForm
            appartement={appartement}
            onCreated={() => {
              setShowForm(false);
              void refresh();
            }}
          />
        )}
      </div>
    );
  }

  return <BailActuelDetail bail={bailActuel} onChanged={refresh} />;
}

function NewBailForm({
  appartement,
  onCreated
}: {
  appartement: Appartement;
  onCreated: () => void;
}): React.JSX.Element {
  const [typeBail, setTypeBail] = useState<BailTypeBail>("vide");
  const [dateDebut, setDateDebut] = useState("");
  const [loyerMensuel, setLoyerMensuel] = useState(appartement.loyerReference ?? "");
  const [depotGarantie, setDepotGarantie] = useState("");
  const [provisionsCharges, setProvisionsCharges] = useState("");
  const [jourEcheance, setJourEcheance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createBail({
        appartementId: appartement.id,
        typeBail,
        dateDebut,
        ...(loyerMensuel && { loyerMensuel }),
        ...(depotGarantie && { depotGarantie }),
        ...(provisionsCharges && { provisionsCharges }),
        ...(jourEcheance && { jourEcheance: Number(jourEcheance) })
      });
      onCreated();
    } catch {
      setError("Impossible de créer le bail");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="mt-2 space-y-4 rounded-lg border border-slate-200 p-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="bail-type" className="text-sm font-medium text-slate-700">
            Type
          </label>
          <select
            id="bail-type"
            value={typeBail}
            onChange={(event) => setTypeBail(event.target.value as BailTypeBail)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {BAIL_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="bail-date-debut" className="text-sm font-medium text-slate-700">
            Date de début
          </label>
          <input
            id="bail-date-debut"
            type="date"
            required
            value={dateDebut}
            onChange={(event) => setDateDebut(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bail-loyer" className="text-sm font-medium text-slate-700">
            Loyer mensuel
          </label>
          <input
            id="bail-loyer"
            value={loyerMensuel}
            onChange={(event) => setLoyerMensuel(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bail-depot" className="text-sm font-medium text-slate-700">
            Dépôt de garantie
          </label>
          <input
            id="bail-depot"
            value={depotGarantie}
            onChange={(event) => setDepotGarantie(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bail-provisions-charges" className="text-sm font-medium text-slate-700">
            Provisions pour charges
          </label>
          <input
            id="bail-provisions-charges"
            value={provisionsCharges}
            onChange={(event) => setProvisionsCharges(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bail-jour-echeance" className="text-sm font-medium text-slate-700">
            Jour d'échéance (1-28)
          </label>
          <input
            id="bail-jour-echeance"
            type="number"
            min={1}
            max={28}
            value={jourEcheance}
            onChange={(event) => setJourEcheance(event.target.value)}
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
        disabled={isSubmitting}
        className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
      >
        {isSubmitting ? "Création…" : "Créer le bail"}
      </button>
    </form>
  );
}

function BailActuelDetail({ bail, onChanged }: { bail: Bail; onChanged: () => void }): React.JSX.Element {
  const [colocataires, setColocataires] = useState<
    Array<{ lien: BailLocataire; locataire: Locataire | null }>
  >([]);
  const [garants, setGarants] = useState<Garant[]>([]);
  const [locatairesDisponibles, setLocatairesDisponibles] = useState<Locataire[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAttachForm, setShowAttachForm] = useState(false);
  const [showGarantForm, setShowGarantForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [dateFinResiliation, setDateFinResiliation] = useState("");
  const [isActionInProgress, setIsActionInProgress] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [liens, garantsData, tousLesLocataires] = await Promise.all([
        listBailLocataires({ bailId: bail.id }),
        listGarants(bail.id),
        listLocataires()
      ]);
      const liensActifs = liens.filter((lien) => lien.archivedAt === null);
      const colocatairesResolus = await Promise.all(
        liensActifs.map(async (lien) => ({
          lien,
          locataire: await getLocataire(lien.locataireId).catch(() => null)
        }))
      );
      setColocataires(colocatairesResolus);
      setGarants(garantsData);
      setLocatairesDisponibles(tousLesLocataires);
      setError(null);
    } catch {
      setError("Impossible de charger les détails du bail");
    }
  }, [bail.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleActiver(): Promise<void> {
    setActionError(null);
    setIsActionInProgress(true);
    try {
      await activerBail(bail.id);
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Impossible d'activer le bail");
    } finally {
      setIsActionInProgress(false);
    }
  }

  async function handleResilier(): Promise<void> {
    setActionError(null);
    setIsActionInProgress(true);
    try {
      await resilierBail(bail.id, dateFinResiliation || undefined);
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Impossible de résilier le bail");
    } finally {
      setIsActionInProgress(false);
    }
  }

  async function handleRetirerColocataire(lienId: string): Promise<void> {
    await archiveBailLocataire(lienId);
    await refresh();
  }

  async function handleRetirerGarant(garantId: string): Promise<void> {
    await archiveGarant(garantId);
    await refresh();
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }

  const locatairesNonAttaches = locatairesDisponibles.filter(
    (locataire) => !colocataires.some((c) => c.lien.locataireId === locataire.id)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Détail du bail</h3>
        <button
          type="button"
          onClick={() => setShowEditForm((value) => !value)}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          {showEditForm ? "Annuler" : "Modifier"}
        </button>
      </div>

      {showEditForm ? (
        <EditBailForm
          bail={bail}
          onSaved={() => {
            setShowEditForm(false);
            onChanged();
          }}
        />
      ) : (
        <dl className="grid grid-cols-2 gap-x-8 text-sm">
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Statut</dt>
            <dd>{bail.statut}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Type</dt>
            <dd>{bail.typeBail}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Loyer</dt>
            <dd>{bail.loyerMensuel ? `${bail.loyerMensuel} €` : "—"}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Dépôt de garantie</dt>
            <dd>{bail.depotGarantie ? `${bail.depotGarantie} €` : "—"}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Provisions pour charges</dt>
            <dd>{bail.provisionsCharges ? `${bail.provisionsCharges} €` : "—"}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Jour d'échéance</dt>
            <dd>{bail.jourEcheance ?? "—"}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Début</dt>
            <dd>{bail.dateDebut}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Fin</dt>
            <dd>{bail.dateFin ?? "—"}</dd>
          </div>
        </dl>
      )}

      {actionError && (
        <p role="alert" className="text-sm text-red-600">
          {actionError}
        </p>
      )}

      <div className="flex items-center gap-4">
        {bail.statut === "brouillon" && (
          <button
            type="button"
            onClick={() => {
              void handleActiver();
            }}
            disabled={isActionInProgress}
            className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
          >
            {isActionInProgress ? "Activation…" : "Activer le bail"}
          </button>
        )}

        {(bail.statut === "actif" || bail.statut === "preavis") && (
          <>
            <input
              id="bail-resiliation-date-fin"
              type="date"
              value={dateFinResiliation}
              onChange={(event) => setDateFinResiliation(event.target.value)}
              placeholder="Date de fin"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                void handleResilier();
              }}
              disabled={isActionInProgress}
              className="rounded-md bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isActionInProgress ? "Résiliation…" : "Résilier le bail"}
            </button>
          </>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Colocataires</h3>
          <button
            type="button"
            onClick={() => setShowAttachForm((value) => !value)}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            {showAttachForm ? "Annuler" : "Rattacher un locataire"}
          </button>
        </div>

        {showAttachForm && (
          <AttachLocataireForm
            bailId={bail.id}
            locatairesDisponibles={locatairesNonAttaches}
            onAttached={() => {
              setShowAttachForm(false);
              void refresh();
            }}
          />
        )}

        {colocataires.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">Aucun locataire rattaché.</p>
        ) : (
          <ul className="mt-1 text-sm">
            {colocataires.map(({ lien, locataire }) => (
              <li key={lien.id} className="flex items-center justify-between py-0.5">
                <span>
                  {locataire ? `${locataire.prenom} ${locataire.nom}` : "—"}{" "}
                  <span className="text-slate-400">({lien.role})</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void handleRetirerColocataire(lien.id);
                  }}
                  className="text-xs text-slate-500 hover:text-red-600"
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Garants</h3>
          <button
            type="button"
            onClick={() => setShowGarantForm((value) => !value)}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            {showGarantForm ? "Annuler" : "Ajouter un garant"}
          </button>
        </div>

        {showGarantForm && (
          <NewGarantForm
            bailId={bail.id}
            onCreated={() => {
              setShowGarantForm(false);
              void refresh();
            }}
          />
        )}

        {garants.filter((garant) => garant.archivedAt === null).length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">Aucun garant.</p>
        ) : (
          <ul className="mt-1 text-sm">
            {garants
              .filter((garant) => garant.archivedAt === null)
              .map((garant) => (
                <li key={garant.id} className="flex items-center justify-between py-0.5">
                  <span>
                    {garant.prenom} {garant.nom}{" "}
                    <span className="text-slate-400">({garant.typeGarantie})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void handleRetirerGarant(garant.id);
                    }}
                    className="text-xs text-slate-500 hover:text-red-600"
                  >
                    Retirer
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EditBailForm({ bail, onSaved }: { bail: Bail; onSaved: () => void }): React.JSX.Element {
  const [typeBail, setTypeBail] = useState<BailTypeBail>(bail.typeBail);
  const [dateDebut, setDateDebut] = useState(bail.dateDebut);
  const [dateFin, setDateFin] = useState(bail.dateFin ?? "");
  const [loyerMensuel, setLoyerMensuel] = useState(bail.loyerMensuel ?? "");
  const [depotGarantie, setDepotGarantie] = useState(bail.depotGarantie ?? "");
  const [provisionsCharges, setProvisionsCharges] = useState(bail.provisionsCharges ?? "");
  const [jourEcheance, setJourEcheance] = useState(bail.jourEcheance?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await updateBail(bail.id, {
        typeBail,
        dateDebut,
        ...(dateFin && { dateFin }),
        ...(loyerMensuel && { loyerMensuel }),
        ...(depotGarantie && { depotGarantie }),
        ...(provisionsCharges && { provisionsCharges }),
        ...(jourEcheance && { jourEcheance: Number(jourEcheance) })
      });
      onSaved();
    } catch {
      setError("Impossible de modifier le bail");
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
          <label htmlFor="bail-edit-type" className="text-sm font-medium text-slate-700">
            Type
          </label>
          <select
            id="bail-edit-type"
            value={typeBail}
            onChange={(event) => setTypeBail(event.target.value as BailTypeBail)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {BAIL_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="bail-edit-date-debut" className="text-sm font-medium text-slate-700">
            Date de début
          </label>
          <input
            id="bail-edit-date-debut"
            type="date"
            required
            value={dateDebut}
            onChange={(event) => setDateDebut(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bail-edit-date-fin" className="text-sm font-medium text-slate-700">
            Date de fin
          </label>
          <input
            id="bail-edit-date-fin"
            type="date"
            value={dateFin}
            onChange={(event) => setDateFin(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bail-edit-loyer" className="text-sm font-medium text-slate-700">
            Loyer mensuel
          </label>
          <input
            id="bail-edit-loyer"
            value={loyerMensuel}
            onChange={(event) => setLoyerMensuel(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bail-edit-depot" className="text-sm font-medium text-slate-700">
            Dépôt de garantie
          </label>
          <input
            id="bail-edit-depot"
            value={depotGarantie}
            onChange={(event) => setDepotGarantie(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bail-edit-provisions-charges" className="text-sm font-medium text-slate-700">
            Provisions pour charges
          </label>
          <input
            id="bail-edit-provisions-charges"
            value={provisionsCharges}
            onChange={(event) => setProvisionsCharges(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bail-edit-jour-echeance" className="text-sm font-medium text-slate-700">
            Jour d'échéance (1-28)
          </label>
          <input
            id="bail-edit-jour-echeance"
            type="number"
            min={1}
            max={28}
            value={jourEcheance}
            onChange={(event) => setJourEcheance(event.target.value)}
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
        disabled={isSubmitting}
        className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
      >
        {isSubmitting ? "Enregistrement…" : "Enregistrer"}
      </button>
    </form>
  );
}

function AttachLocataireForm({
  bailId,
  locatairesDisponibles,
  onAttached
}: {
  bailId: string;
  locatairesDisponibles: Locataire[];
  onAttached: () => void;
}): React.JSX.Element {
  const [locataireId, setLocataireId] = useState(locatairesDisponibles[0]?.id ?? "");
  const [role, setRole] = useState<BailLocataireRole>("titulaire");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createBailLocataire({ bailId, locataireId, role });
      onAttached();
    } catch {
      setError("Impossible de rattacher ce locataire");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (locatairesDisponibles.length === 0) {
    return <p className="mt-1 text-sm text-slate-500">Tous les locataires existants sont déjà rattachés.</p>;
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="mt-2 flex items-center gap-3 rounded-md border border-slate-200 p-3"
    >
      <select
        id="bail-attach-locataire"
        value={locataireId}
        onChange={(event) => setLocataireId(event.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      >
        {locatairesDisponibles.map((locataire) => (
          <option key={locataire.id} value={locataire.id}>
            {locataire.prenom} {locataire.nom}
          </option>
        ))}
      </select>
      <select
        id="bail-attach-role"
        value={role}
        onChange={(event) => setRole(event.target.value as BailLocataireRole)}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      >
        {ROLES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
      >
        {isSubmitting ? "Ajout…" : "Rattacher"}
      </button>
    </form>
  );
}

function NewGarantForm({ bailId, onCreated }: { bailId: string; onCreated: () => void }): React.JSX.Element {
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [typeGarantie, setTypeGarantie] = useState<GarantTypeGarantie>("personne_physique");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createGarant({ bailId, nom, prenom, typeGarantie });
      onCreated();
    } catch {
      setError("Impossible d'ajouter le garant");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="mt-2 space-y-3 rounded-md border border-slate-200 p-3"
    >
      <div className="grid grid-cols-3 gap-3">
        <input
          id="bail-garant-nom"
          required
          placeholder="Nom"
          value={nom}
          onChange={(event) => setNom(event.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <input
          id="bail-garant-prenom"
          required
          placeholder="Prénom"
          value={prenom}
          onChange={(event) => setPrenom(event.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <select
          id="bail-garant-type"
          value={typeGarantie}
          onChange={(event) => setTypeGarantie(event.target.value as GarantTypeGarantie)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {GARANT_TYPES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
      >
        {isSubmitting ? "Ajout…" : "Ajouter"}
      </button>
    </form>
  );
}

export function HistoriqueBauxTab({ appartement }: { appartement: Appartement }): React.JSX.Element {
  const [baux, setBaux] = useState<Bail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const tous = await listBaux({ appartementId: appartement.id });
      setBaux(tous.filter((bail) => !STATUTS_BAIL_EN_COURS.has(bail.statut)));
      setError(null);
    } catch {
      setError("Impossible de charger l'historique des baux");
    }
  }, [appartement.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }

  const visibles = showArchived ? baux : baux.filter((bail) => bail.statut !== "archive");

  return (
    <div>
      <div className="flex items-center justify-end">
        <ArchiveToggle show={showArchived} onToggle={() => setShowArchived((value) => !value)} />
      </div>

      {visibles.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Aucun bail antérieur.</p>
      ) : (
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 font-medium">Type</th>
              <th className="py-2 font-medium">Début</th>
              <th className="py-2 font-medium">Fin</th>
              <th className="py-2 font-medium">Loyer</th>
              <th className="py-2 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((bail) => (
              <tr
                key={bail.id}
                className={`border-b border-slate-100 ${bail.statut === "archive" ? ARCHIVED_ROW_CLASSNAME : ""}`}
              >
                <td className="py-2">{bail.typeBail}</td>
                <td className="py-2">{bail.dateDebut}</td>
                <td className="py-2">{bail.dateFin ?? "—"}</td>
                <td className="py-2">{bail.loyerMensuel ? `${bail.loyerMensuel} €` : "—"}</td>
                <td className="py-2">
                  {bail.statut}
                  {bail.statut === "archive" && <ArchiveBadge />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
