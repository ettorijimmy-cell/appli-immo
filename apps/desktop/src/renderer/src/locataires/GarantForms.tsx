import { useState, type FormEvent } from "react";
import { ApiError } from "../lib/authenticated-fetch";
import { createGarant, updateGarant, type Garant, type GarantTypeGarantie } from "./api";
import {
  champsGarantDepuis,
  champsGarantVides,
  creationGarant,
  GARANT_TYPES,
  modificationGarant,
  type ChampsGarant
} from "./garant-formulaire";

// Formulaires d'ajout et de modification d'un garant, partagés par la fiche
// locataire (LocataireDetailView.tsx) et l'onglet « Bail actuel »
// (patrimoine/BailTabs.tsx), qui en avaient chacun une copie jusqu'au
// 2026-11-07. `idPrefix` conserve les id DOM que portait la copie de
// l'onglet « Bail actuel » (ex. "bail-garant-nom") ; sans lui, aucun id.

const CLASSE_CHAMP = "rounded-md border border-slate-300 px-2 py-1 text-sm";

function ChampsGarantFormulaire({
  champs,
  onChange,
  idPrefix
}: {
  champs: ChampsGarant;
  onChange: (modif: Partial<ChampsGarant>) => void;
  idPrefix?: string | undefined;
}): React.JSX.Element {
  const id =(suffixe: string): string | undefined => (idPrefix ? `${idPrefix}-${suffixe}` : undefined);
  return (
    <div className="grid grid-cols-3 gap-3">
      <input
        id={id("nom")}
        required
        placeholder="Nom"
        value={champs.nom}
        onChange={(event) => onChange({ nom: event.target.value })}
        className={CLASSE_CHAMP}
      />
      <input
        id={id("prenom")}
        required
        placeholder="Prénom"
        value={champs.prenom}
        onChange={(event) => onChange({ prenom: event.target.value })}
        className={CLASSE_CHAMP}
      />
      <input
        id={id("email")}
        type="email"
        placeholder="Email"
        value={champs.email}
        onChange={(event) => onChange({ email: event.target.value })}
        className={CLASSE_CHAMP}
      />
      <input
        id={id("telephone")}
        placeholder="Téléphone"
        value={champs.telephone}
        onChange={(event) => onChange({ telephone: event.target.value })}
        className={CLASSE_CHAMP}
      />
      <select
        id={id("type")}
        value={champs.typeGarantie}
        onChange={(event) => onChange({ typeGarantie: event.target.value as GarantTypeGarantie })}
        className={CLASSE_CHAMP}
      >
        {GARANT_TYPES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <input
        id={id("date-naissance")}
        type="date"
        placeholder="Date de naissance"
        value={champs.dateNaissance}
        onChange={(event) => onChange({ dateNaissance: event.target.value })}
        className={CLASSE_CHAMP}
      />
      <input
        id={id("lieu-naissance")}
        placeholder="Lieu de naissance"
        value={champs.lieuNaissance}
        onChange={(event) => onChange({ lieuNaissance: event.target.value })}
        className={CLASSE_CHAMP}
      />
      <input
        id={id("nationalite")}
        placeholder="Nationalité"
        value={champs.nationalite}
        onChange={(event) => onChange({ nationalite: event.target.value })}
        className={CLASSE_CHAMP}
      />
    </div>
  );
}

export function NewGarantForm({
  bailId,
  onCreated,
  idPrefix
}: {
  bailId: string;
  onCreated: () => void;
  idPrefix?: string;
}): React.JSX.Element {
  const [champs, setChamps] = useState<ChampsGarant>(champsGarantVides);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createGarant(creationGarant(bailId, champs));
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'ajouter le garant");
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
      <ChampsGarantFormulaire
        champs={champs}
        onChange={(modif) => setChamps((precedent) => ({ ...precedent, ...modif }))}
        idPrefix={idPrefix}
      />
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

export function EditGarantForm({
  garant,
  onSaved,
  onCancel
}: {
  garant: Garant;
  onSaved: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [champs, setChamps] = useState<ChampsGarant>(() => champsGarantDepuis(garant));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await updateGarant(garant.id, modificationGarant(champs));
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer les modifications");
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
      <ChampsGarantFormulaire
        champs={champs}
        onChange={(modif) => setChamps((precedent) => ({ ...precedent, ...modif }))}
      />
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {isSubmitting ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700">
          Annuler
        </button>
      </div>
    </form>
  );
}
