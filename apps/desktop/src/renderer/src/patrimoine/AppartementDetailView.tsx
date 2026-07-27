import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  archiveEquipement,
  createEquipement,
  getAppartement,
  listEquipements,
  updateAppartement,
  updateEquipement,
  type Appartement,
  type AppartementStatutModifiable,
  type AppartementType,
  type Equipement,
  type EquipementType
} from "./api";

const EQUIPEMENT_TYPES: EquipementType[] = ["chaudiere", "ballon_eau_chaude", "autre"];
const APPARTEMENT_TYPES: AppartementType[] = ["T1", "T2", "T3", "T4", "T5+"];
// "archive" en est exclu : l'archivage a son propre bouton dédié.
const APPARTEMENT_STATUTS_MODIFIABLES: AppartementStatutModifiable[] = ["vacant", "loue", "travaux"];

type Tab = "infos" | "equipements";

export function AppartementDetailView({
  appartementId,
  onBack
}: {
  appartementId: string;
  onBack: () => void;
}): React.JSX.Element {
  const [appartement, setAppartement] = useState<Appartement | null>(null);
  const [equipements, setEquipements] = useState<Equipement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("infos");
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingEquipementId, setEditingEquipementId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [appartementData, equipementsData] = await Promise.all([
        getAppartement(appartementId),
        listEquipements(appartementId)
      ]);
      setAppartement(appartementData);
      setEquipements(equipementsData);
      setError(null);
    } catch {
      setError("Impossible de charger la fiche appartement");
    }
  }, [appartementId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleArchive(id: string): Promise<void> {
    await archiveEquipement(id);
    await refresh();
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }

  if (!appartement) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700">
        ← {"Retour à l'immeuble"}
      </button>

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Appartement {appartement.numero}</h1>
        {tab === "infos" && (
          <button
            type="button"
            onClick={() => setIsEditing((value) => !value)}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            {isEditing ? "Annuler" : "Modifier"}
          </button>
        )}
      </div>

      <div className="flex gap-4 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab("infos")}
          className={`border-b-2 px-1 pb-2 text-sm font-medium ${
            tab === "infos"
              ? "border-indigo-700 text-indigo-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Infos
        </button>
        <button
          type="button"
          onClick={() => {
            setIsEditing(false);
            setTab("equipements");
          }}
          className={`border-b-2 px-1 pb-2 text-sm font-medium ${
            tab === "equipements"
              ? "border-indigo-700 text-indigo-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Équipements
        </button>
      </div>

      {tab === "infos" ? (
        isEditing ? (
          <EditAppartementForm
            appartement={appartement}
            onSaved={() => {
              setIsEditing(false);
              void refresh();
            }}
          />
        ) : (
          <dl className="grid grid-cols-2 gap-x-8 text-sm">
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Type</dt>
              <dd>{appartement.type}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Statut</dt>
              <dd>{appartement.statut}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Surface</dt>
              <dd>{appartement.surface ? `${appartement.surface} m²` : "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Loyer de référence</dt>
              <dd>{appartement.loyerReference ? `${appartement.loyerReference} €` : "—"}</dd>
            </div>
          </dl>
        )
      ) : (
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Équipements</h2>
            <button
              type="button"
              onClick={() => setShowForm((value) => !value)}
              className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
            >
              {showForm ? "Annuler" : "Nouvel équipement"}
            </button>
          </div>

          {showForm && (
            <NewEquipementForm
              appartementId={appartement.id}
              onCreated={() => {
                setShowForm(false);
                void refresh();
              }}
            />
          )}

          {equipements.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Aucun équipement pour le moment.</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Dernier entretien</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {equipements.map((equipement) =>
                  editingEquipementId === equipement.id ? (
                    <EditEquipementRow
                      key={equipement.id}
                      equipement={equipement}
                      onSaved={() => {
                        setEditingEquipementId(null);
                        void refresh();
                      }}
                      onCancel={() => setEditingEquipementId(null)}
                    />
                  ) : (
                    <tr key={equipement.id} className="border-b border-slate-100">
                      <td className="py-2">{equipement.type}</td>
                      <td className="py-2">{equipement.dateDernierEntretien ?? "—"}</td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setEditingEquipementId(equipement.id)}
                          className="mr-4 text-sm text-slate-500 hover:text-slate-700"
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleArchive(equipement.id);
                          }}
                          className="text-sm text-slate-500 hover:text-red-600"
                        >
                          Archiver
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function NewEquipementForm({
  appartementId,
  onCreated
}: {
  appartementId: string;
  onCreated: () => void;
}): React.JSX.Element {
  const [type, setType] = useState<EquipementType>("chaudiere");
  const [dateDernierEntretien, setDateDernierEntretien] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createEquipement({
        appartementId,
        type,
        ...(dateDernierEntretien && { dateDernierEntretien })
      });
      setDateDernierEntretien("");
      onCreated();
    } catch {
      setError("Impossible de créer l'équipement");
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
          <label htmlFor="equipement-type" className="text-sm font-medium text-slate-700">
            Type
          </label>
          <select
            id="equipement-type"
            value={type}
            onChange={(event) => setType(event.target.value as EquipementType)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {EQUIPEMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="equipement-date" className="text-sm font-medium text-slate-700">
            Dernier entretien
          </label>
          <input
            id="equipement-date"
            type="date"
            value={dateDernierEntretien}
            onChange={(event) => setDateDernierEntretien(event.target.value)}
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
        {isSubmitting ? "Création…" : "Ajouter l'équipement"}
      </button>
    </form>
  );
}

function EditAppartementForm({
  appartement,
  onSaved
}: {
  appartement: Appartement;
  onSaved: () => void;
}): React.JSX.Element {
  const [numero, setNumero] = useState(appartement.numero);
  const [type, setType] = useState<AppartementType>(appartement.type);
  const [surface, setSurface] = useState(appartement.surface ?? "");
  const [loyerReference, setLoyerReference] = useState(appartement.loyerReference ?? "");
  const [statut, setStatut] = useState<AppartementStatutModifiable>(
    appartement.statut === "archive" ? "vacant" : appartement.statut
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await updateAppartement(appartement.id, {
        numero,
        type,
        statut,
        ...(surface && { surface }),
        ...(loyerReference && { loyerReference })
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
      className="space-y-4 rounded-lg border border-slate-200 p-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="appartement-edit-numero" className="text-sm font-medium text-slate-700">
            Numéro
          </label>
          <input
            id="appartement-edit-numero"
            required
            value={numero}
            onChange={(event) => setNumero(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="appartement-edit-type" className="text-sm font-medium text-slate-700">
            Type
          </label>
          <select
            id="appartement-edit-type"
            value={type}
            onChange={(event) => setType(event.target.value as AppartementType)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {APPARTEMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="appartement-edit-surface" className="text-sm font-medium text-slate-700">
            Surface (m²)
          </label>
          <input
            id="appartement-edit-surface"
            value={surface}
            onChange={(event) => setSurface(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="appartement-edit-loyer" className="text-sm font-medium text-slate-700">
            Loyer de référence
          </label>
          <input
            id="appartement-edit-loyer"
            value={loyerReference}
            onChange={(event) => setLoyerReference(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="appartement-edit-statut" className="text-sm font-medium text-slate-700">
            Statut
          </label>
          <select
            id="appartement-edit-statut"
            value={statut}
            onChange={(event) => setStatut(event.target.value as AppartementStatutModifiable)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {APPARTEMENT_STATUTS_MODIFIABLES.map((value) => (
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

function EditEquipementRow({
  equipement,
  onSaved,
  onCancel
}: {
  equipement: Equipement;
  onSaved: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [type, setType] = useState<EquipementType>(equipement.type);
  const [dateDernierEntretien, setDateDernierEntretien] = useState(equipement.dateDernierEntretien ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSave(): Promise<void> {
    setError(null);
    setIsSubmitting(true);
    try {
      await updateEquipement(equipement.id, {
        type,
        ...(dateDernierEntretien && { dateDernierEntretien })
      });
      onSaved();
    } catch {
      setError("Impossible d'enregistrer les modifications");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <tr className="border-b border-slate-100">
      <td className="py-2">
        <select
          value={type}
          onChange={(event) => setType(event.target.value as EquipementType)}
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {EQUIPEMENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2">
        <input
          type="date"
          value={dateDernierEntretien}
          onChange={(event) => setDateDernierEntretien(event.target.value)}
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </td>
      <td className="py-2 text-right">
        <button
          type="button"
          onClick={() => {
            void handleSave();
          }}
          disabled={isSubmitting}
          className="mr-4 text-sm text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
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
