import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import {
  createCompteBancaire,
  getSci,
  listComptesBancaires,
  type CompteBancaire,
  type Sci
} from "../scis/api";

export function SciDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [sci, setSci] = useState<Sci | null>(null);
  const [comptes, setComptes] = useState<CompteBancaire[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) {
      return;
    }
    try {
      // Le compte bancaire est lu via l'endpoint dédié qui renvoie l'IBAN
      // déjà déchiffré côté backend — jamais de déchiffrement local ici.
      const [sciData, comptesData] = await Promise.all([getSci(id), listComptesBancaires(id)]);
      setSci(sciData);
      setComptes(comptesData);
      setError(null);
    } catch {
      setError("Impossible de charger la fiche SCI");
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!id) {
    return (
      <p role="alert" className="text-sm text-red-600">
        SCI introuvable
      </p>
    );
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }

  if (!sci) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">{sci.nom}</h1>
        <dl className="mt-2 grid grid-cols-2 gap-x-8 text-sm">
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Régime fiscal</dt>
            <dd>{sci.regimeFiscal}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Statut</dt>
            <dd>{sci.statut}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">Forme juridique</dt>
            <dd>{sci.formeJuridique ?? "—"}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-1">
            <dt className="text-slate-500">SIRET</dt>
            <dd>{sci.siret ?? "—"}</dd>
          </div>
        </dl>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Comptes bancaires</h2>
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            {showForm ? "Annuler" : "Ajouter un compte"}
          </button>
        </div>

        {showForm && (
          <NewCompteBancaireForm
            sciId={sci.id}
            onCreated={() => {
              setShowForm(false);
              void refresh();
            }}
          />
        )}

        {comptes.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Aucun compte bancaire pour le moment.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 font-medium">IBAN</th>
                <th className="py-2 font-medium">BIC</th>
              </tr>
            </thead>
            <tbody>
              {comptes.map((compte) => (
                <tr key={compte.id} className="border-b border-slate-100">
                  <td className="py-2 font-mono">{compte.iban}</td>
                  <td className="py-2 font-mono">{compte.bic}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function NewCompteBancaireForm({
  sciId,
  onCreated
}: {
  sciId: string;
  onCreated: () => void;
}): React.JSX.Element {
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createCompteBancaire({ sciId, iban: iban.toUpperCase(), bic: bic.toUpperCase() });
      setIban("");
      setBic("");
      onCreated();
    } catch {
      setError("IBAN/BIC invalide ou requête refusée");
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
          <label htmlFor="iban" className="text-sm font-medium text-slate-700">
            IBAN
          </label>
          <input
            id="iban"
            required
            value={iban}
            onChange={(event) => setIban(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bic" className="text-sm font-medium text-slate-700">
            BIC
          </label>
          <input
            id="bic"
            required
            value={bic}
            onChange={(event) => setBic(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
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
        {isSubmitting ? "Ajout…" : "Ajouter"}
      </button>
    </form>
  );
}
