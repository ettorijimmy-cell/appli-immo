import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createCompteBancaire, getSci, listComptesBancaires, type CompteBancaire, type Sci } from "../scis/api";
import { archiveImmeuble, createImmeuble, listImmeubles, type Immeuble } from "./api";
import { ARCHIVED_ROW_CLASSNAME, ArchiveBadge, ArchiveToggle } from "./ArchiveFilter";

export function SciDetailView({
  sciId,
  onBack,
  onSelectImmeuble
}: {
  sciId: string;
  onBack: () => void;
  onSelectImmeuble: (immeubleId: string) => void;
}): React.JSX.Element {
  const [sci, setSci] = useState<Sci | null>(null);
  const [comptes, setComptes] = useState<CompteBancaire[]>([]);
  const [immeubles, setImmeubles] = useState<Immeuble[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCompteForm, setShowCompteForm] = useState(false);
  const [showImmeubleForm, setShowImmeubleForm] = useState(false);
  const [showArchivedImmeubles, setShowArchivedImmeubles] = useState(false);

  const refresh = useCallback(async () => {
    try {
      // Le compte bancaire est lu via l'endpoint dédié qui renvoie l'IBAN
      // déjà déchiffré côté backend — jamais de déchiffrement local ici.
      const [sciData, comptesData, immeublesData] = await Promise.all([
        getSci(sciId),
        listComptesBancaires(sciId),
        listImmeubles(sciId)
      ]);
      setSci(sciData);
      setComptes(comptesData);
      setImmeubles(immeublesData);
      setError(null);
    } catch {
      setError("Impossible de charger la fiche SCI");
    }
  }, [sciId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleArchiveImmeuble(id: string): Promise<void> {
    await archiveImmeuble(id);
    await refresh();
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
      <button type="button" onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700">
        ← Toutes les SCI
      </button>

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
          <h2 className="text-sm font-semibold text-slate-700">Immeubles</h2>
          <div className="flex items-center gap-4">
            <ArchiveToggle
              show={showArchivedImmeubles}
              onToggle={() => setShowArchivedImmeubles((value) => !value)}
            />
            <button
              type="button"
              onClick={() => setShowImmeubleForm((value) => !value)}
              className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
            >
              {showImmeubleForm ? "Annuler" : "Nouvel immeuble"}
            </button>
          </div>
        </div>

        {showImmeubleForm && (
          <NewImmeubleForm
            sciId={sci.id}
            onCreated={() => {
              setShowImmeubleForm(false);
              void refresh();
            }}
          />
        )}

        {(() => {
          const visibleImmeubles = showArchivedImmeubles
            ? immeubles
            : immeubles.filter((immeuble) => immeuble.statut !== "archive");
          return visibleImmeubles.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Aucun immeuble pour le moment.</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 font-medium">Nom</th>
                  <th className="py-2 font-medium">Adresse</th>
                  <th className="py-2 font-medium">Statut</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visibleImmeubles.map((immeuble) => (
                  <tr
                    key={immeuble.id}
                    className={`border-b border-slate-100 ${immeuble.statut === "archive" ? ARCHIVED_ROW_CLASSNAME : ""}`}
                  >
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => onSelectImmeuble(immeuble.id)}
                        className="text-indigo-700 hover:underline"
                      >
                        {immeuble.nom}
                      </button>
                      {immeuble.statut === "archive" && <ArchiveBadge />}
                    </td>
                    <td className="py-2">
                      {immeuble.adresse}
                      {immeuble.ville ? `, ${immeuble.ville}` : ""}
                    </td>
                    <td className="py-2">{immeuble.statut}</td>
                    <td className="py-2 text-right">
                      {immeuble.statut === "actif" && (
                        <button
                          type="button"
                          onClick={() => {
                            void handleArchiveImmeuble(immeuble.id);
                          }}
                          className="text-sm text-slate-500 hover:text-red-600"
                        >
                          Archiver
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Comptes bancaires</h2>
          <button
            type="button"
            onClick={() => setShowCompteForm((value) => !value)}
            className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            {showCompteForm ? "Annuler" : "Ajouter un compte"}
          </button>
        </div>

        {showCompteForm && (
          <NewCompteBancaireForm
            sciId={sci.id}
            onCreated={() => {
              setShowCompteForm(false);
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

function NewImmeubleForm({
  sciId,
  onCreated
}: {
  sciId: string;
  onCreated: () => void;
}): React.JSX.Element {
  const [nom, setNom] = useState("");
  const [adresse, setAdresse] = useState("");
  const [codePostal, setCodePostal] = useState("");
  const [ville, setVille] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createImmeuble({
        sciId,
        nom,
        adresse,
        ...(codePostal && { codePostal }),
        ...(ville && { ville })
      });
      setNom("");
      setAdresse("");
      setCodePostal("");
      setVille("");
      onCreated();
    } catch {
      setError("Impossible de créer l'immeuble");
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
          <label htmlFor="immeuble-nom" className="text-sm font-medium text-slate-700">
            Nom
          </label>
          <input
            id="immeuble-nom"
            required
            value={nom}
            onChange={(event) => setNom(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="immeuble-adresse" className="text-sm font-medium text-slate-700">
            Adresse
          </label>
          <input
            id="immeuble-adresse"
            required
            value={adresse}
            onChange={(event) => setAdresse(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="immeuble-code-postal" className="text-sm font-medium text-slate-700">
            Code postal
          </label>
          <input
            id="immeuble-code-postal"
            value={codePostal}
            onChange={(event) => setCodePostal(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="immeuble-ville" className="text-sm font-medium text-slate-700">
            Ville
          </label>
          <input
            id="immeuble-ville"
            value={ville}
            onChange={(event) => setVille(event.target.value)}
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
        {isSubmitting ? "Création…" : "Créer l'immeuble"}
      </button>
    </form>
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
