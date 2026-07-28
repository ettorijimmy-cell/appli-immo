import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { ArchiveBadge } from "../components/ArchiveFilter";
import { DocumentsForEntite } from "../documents/DocumentsForEntite";
import { getAppartement, type Appartement } from "../patrimoine/api";
import {
  archiveGarant,
  archiveLocataire,
  createGarant,
  getBail,
  getLocataire,
  listBailLocataires,
  listGarants,
  updateLocataire,
  type Bail,
  type BailLocataire,
  type Garant,
  type GarantTypeGarantie,
  type Locataire,
  type LocataireStatutModifiable
} from "./api";

const GARANT_TYPES: GarantTypeGarantie[] = ["personne_physique", "garantie_visale", "autre"];
const LOCATAIRE_STATUTS_MODIFIABLES: LocataireStatutModifiable[] = ["actif", "ancien"];

interface BailAvecContexte {
  bail: Bail;
  appartement: Appartement | null;
  colocataires: Array<{ lien: BailLocataire; locataire: Locataire | null }>;
  garants: Garant[];
}

export function LocataireDetailView({
  locataireId,
  onBack
}: {
  locataireId: string;
  onBack: () => void;
}): React.JSX.Element {
  const [locataire, setLocataire] = useState<Locataire | null>(null);
  const [bauxEnCours, setBauxEnCours] = useState<BailAvecContexte[]>([]);
  const [bauxHistorique, setBauxHistorique] = useState<BailAvecContexte[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [locataireData, liens] = await Promise.all([
        getLocataire(locataireId),
        listBailLocataires({ locataireId })
      ]);
      setLocataire(locataireData);

      const liensActifs = liens.filter((lien) => lien.archivedAt === null);
      const contextes = await Promise.all(
        liensActifs.map(async (lien): Promise<BailAvecContexte> => {
          const bail = await getBail(lien.bailId);
          const [appartement, colocatairesLiens, garants] = await Promise.all([
            getAppartement(bail.appartementId).catch(() => null),
            listBailLocataires({ bailId: bail.id }),
            listGarants(bail.id)
          ]);
          const colocataires = await Promise.all(
            colocatairesLiens
              .filter((colocLien) => colocLien.archivedAt === null)
              .map(async (colocLien) => ({
                lien: colocLien,
                locataire: await getLocataire(colocLien.locataireId).catch(() => null)
              }))
          );
          return { bail, appartement, colocataires, garants };
        })
      );

      setBauxEnCours(contextes.filter((c) => c.bail.statut === "actif" || c.bail.statut === "preavis"));
      setBauxHistorique(contextes.filter((c) => c.bail.statut !== "actif" && c.bail.statut !== "preavis"));
      setError(null);
    } catch {
      setError("Impossible de charger la fiche locataire");
    }
  }, [locataireId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleArchiveLocataire(): Promise<void> {
    await archiveLocataire(locataireId);
    await refresh();
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }

  if (!locataire) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700">
        ← Tous les locataires
      </button>

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          {locataire.prenom} {locataire.nom}
          {locataire.statut === "archive" && <ArchiveBadge />}
        </h1>
        {locataire.statut !== "archive" && (
          <button
            type="button"
            onClick={() => {
              void handleArchiveLocataire();
            }}
            className="text-sm text-slate-500 hover:text-red-600"
          >
            Archiver
          </button>
        )}
      </div>

      <div className="space-y-4">
        <CollapsibleSection title="Coordonnées">
          {isEditing ? (
            <EditLocataireForm
              locataire={locataire}
              onSaved={() => {
                setIsEditing(false);
                void refresh();
              }}
            />
          ) : (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-8 text-sm">
                <div className="flex justify-between border-b border-slate-100 py-1">
                  <dt className="text-slate-500">Email</dt>
                  <dd>{locataire.email ?? "—"}</dd>
                </div>
                <div className="flex justify-between border-b border-slate-100 py-1">
                  <dt className="text-slate-500">Téléphone</dt>
                  <dd>{locataire.telephone ?? "—"}</dd>
                </div>
                <div className="flex justify-between border-b border-slate-100 py-1">
                  <dt className="text-slate-500">Statut</dt>
                  <dd>{locataire.statut}</dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Modifier
              </button>
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection title={`Bail en cours (${bauxEnCours.length})`}>
          {bauxEnCours.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun bail en cours.</p>
          ) : (
            <div className="space-y-6">
              {bauxEnCours.map((contexte) => (
                <BailDetail key={contexte.bail.id} contexte={contexte} onChanged={refresh} />
              ))}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection title={`Historique des baux (${bauxHistorique.length})`} defaultOpen={false}>
          {bauxHistorique.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun bail antérieur.</p>
          ) : (
            <div className="space-y-4">
              {bauxHistorique.map((contexte) => (
                <BailDetail key={contexte.bail.id} contexte={contexte} onChanged={refresh} readOnly />
              ))}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Documents">
          <DocumentsForEntite entiteType="locataire" entiteId={locataireId} />
        </CollapsibleSection>
      </div>
    </div>
  );
}

function BailDetail({
  contexte,
  onChanged,
  readOnly = false
}: {
  contexte: BailAvecContexte;
  onChanged: () => void;
  readOnly?: boolean;
}): React.JSX.Element {
  const { bail, appartement, colocataires, garants } = contexte;
  const [showGarantForm, setShowGarantForm] = useState(false);

  async function handleArchiveGarant(id: string): Promise<void> {
    await archiveGarant(id);
    onChanged();
  }

  return (
    <div className="rounded-md border border-slate-100 p-3">
      <dl className="grid grid-cols-2 gap-x-8 text-sm">
        <div className="flex justify-between border-b border-slate-100 py-1">
          <dt className="text-slate-500">Appartement</dt>
          <dd>{appartement ? `n°${appartement.numero}` : "—"}</dd>
        </div>
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
          <dt className="text-slate-500">Début</dt>
          <dd>{bail.dateDebut}</dd>
        </div>
        <div className="flex justify-between border-b border-slate-100 py-1">
          <dt className="text-slate-500">Fin</dt>
          <dd>{bail.dateFin ?? "—"}</dd>
        </div>
      </dl>

      <div className="mt-3">
        <h3 className="text-xs font-semibold uppercase text-slate-500">Colocataires</h3>
        <ul className="mt-1 text-sm">
          {colocataires.map(({ lien, locataire }) => (
            <li key={lien.id}>
              {locataire ? `${locataire.prenom} ${locataire.nom}` : "—"}{" "}
              <span className="text-slate-400">({lien.role})</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase text-slate-500">Garants</h3>
          {!readOnly && (
            <button
              type="button"
              onClick={() => setShowGarantForm((value) => !value)}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              {showGarantForm ? "Annuler" : "Ajouter un garant"}
            </button>
          )}
        </div>

        {showGarantForm && (
          <NewGarantForm
            bailId={bail.id}
            onCreated={() => {
              setShowGarantForm(false);
              onChanged();
            }}
          />
        )}

        {garants.filter((g) => g.archivedAt === null).length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">Aucun garant.</p>
        ) : (
          <ul className="mt-1 text-sm">
            {garants
              .filter((g) => g.archivedAt === null)
              .map((garant) => (
                <li key={garant.id} className="flex items-center justify-between py-0.5">
                  <span>
                    {garant.prenom} {garant.nom} <span className="text-slate-400">({garant.typeGarantie})</span>
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        void handleArchiveGarant(garant.id);
                      }}
                      className="text-xs text-slate-500 hover:text-red-600"
                    >
                      Retirer
                    </button>
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
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
          required
          placeholder="Nom"
          value={nom}
          onChange={(event) => setNom(event.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <input
          required
          placeholder="Prénom"
          value={prenom}
          onChange={(event) => setPrenom(event.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <select
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

function EditLocataireForm({
  locataire,
  onSaved
}: {
  locataire: Locataire;
  onSaved: () => void;
}): React.JSX.Element {
  const [nom, setNom] = useState(locataire.nom);
  const [prenom, setPrenom] = useState(locataire.prenom);
  const [email, setEmail] = useState(locataire.email ?? "");
  const [telephone, setTelephone] = useState(locataire.telephone ?? "");
  const [statut, setStatut] = useState<LocataireStatutModifiable>(
    locataire.statut === "archive" ? "actif" : locataire.statut
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await updateLocataire(locataire.id, {
        nom,
        prenom,
        statut,
        ...(email && { email }),
        ...(telephone && { telephone })
      });
      onSaved();
    } catch {
      setError("Impossible d'enregistrer les modifications");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="locataire-edit-nom" className="text-sm font-medium text-slate-700">
            Nom
          </label>
          <input
            id="locataire-edit-nom"
            required
            value={nom}
            onChange={(event) => setNom(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="locataire-edit-prenom" className="text-sm font-medium text-slate-700">
            Prénom
          </label>
          <input
            id="locataire-edit-prenom"
            required
            value={prenom}
            onChange={(event) => setPrenom(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="locataire-edit-email" className="text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="locataire-edit-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="locataire-edit-telephone" className="text-sm font-medium text-slate-700">
            Téléphone
          </label>
          <input
            id="locataire-edit-telephone"
            value={telephone}
            onChange={(event) => setTelephone(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="locataire-edit-statut" className="text-sm font-medium text-slate-700">
            Statut
          </label>
          <select
            id="locataire-edit-statut"
            value={statut}
            onChange={(event) => setStatut(event.target.value as LocataireStatutModifiable)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {LOCATAIRE_STATUTS_MODIFIABLES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
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
