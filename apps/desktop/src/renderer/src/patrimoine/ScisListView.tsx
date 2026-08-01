import { useCallback, useEffect, useState, type FormEvent } from "react";
import { archiveSci, createSci, listScis, type CreateSciInput, type Sci } from "../scis/api";
import { ARCHIVED_ROW_CLASSNAME, ArchiveBadge, ArchiveToggle } from "../components/ArchiveFilter";

export function ScisListView({ onSelect }: { onSelect: (sciId: string) => void }): React.JSX.Element {
  const [scis, setScis] = useState<Sci[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setScis(await listScis());
      setError(null);
    } catch {
      setError("Impossible de charger les SCI");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleArchive(id: string): Promise<void> {
    await archiveSci(id);
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Patrimoine</h1>
        <div className="flex items-center gap-4">
          <ArchiveToggle show={showArchived} onToggle={() => setShowArchived((value) => !value)} />
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            {showForm ? "Annuler" : "Nouvelle SCI"}
          </button>
        </div>
      </div>

      {showForm && (
        <NewSciForm
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

      {(() => {
        const visibleScis = showArchived ? scis : scis.filter((sci) => sci.statut !== "archive");
        return isLoading ? (
          <p className="text-sm text-slate-500">Chargement…</p>
        ) : visibleScis.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune SCI pour le moment.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 font-medium">Nom</th>
                <th className="py-2 font-medium">Régime fiscal</th>
                <th className="py-2 font-medium">Statut</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {visibleScis.map((sci) => (
                <tr
                  key={sci.id}
                  className={`border-b border-slate-100 ${sci.statut === "archive" ? ARCHIVED_ROW_CLASSNAME : ""}`}
                >
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => onSelect(sci.id)}
                      className="text-indigo-700 hover:underline"
                    >
                      {sci.nom}
                    </button>
                    {sci.statut === "archive" && <ArchiveBadge />}
                  </td>
                  <td className="py-2">{sci.regimeFiscal}</td>
                  <td className="py-2">{sci.statut}</td>
                  <td className="py-2 text-right">
                    {sci.statut === "active" && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleArchive(sci.id);
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
  );
}

function NewSciForm({ onCreated }: { onCreated: () => void }): React.JSX.Element {
  const [nom, setNom] = useState("");
  const [regimeFiscal, setRegimeFiscal] = useState<CreateSciInput["regimeFiscal"]>("IR");
  const [formeJuridique, setFormeJuridique] = useState("");
  const [siret, setSiret] = useState("");
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
      await createSci({
        nom,
        regimeFiscal,
        adresse,
        codePostal,
        ville,
        ...(formeJuridique && { formeJuridique }),
        ...(siret && { siret })
      });
      onCreated();
    } catch {
      setError("Impossible de créer la SCI");
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
          <label htmlFor="nom" className="text-sm font-medium text-slate-700">
            Nom
          </label>
          <input
            id="nom"
            required
            value={nom}
            onChange={(event) => setNom(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="regimeFiscal" className="text-sm font-medium text-slate-700">
            Régime fiscal
          </label>
          <select
            id="regimeFiscal"
            value={regimeFiscal}
            onChange={(event) => setRegimeFiscal(event.target.value as CreateSciInput["regimeFiscal"])}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="IR">IR</option>
            <option value="IS">IS</option>
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="formeJuridique" className="text-sm font-medium text-slate-700">
            Forme juridique
          </label>
          <input
            id="formeJuridique"
            value={formeJuridique}
            onChange={(event) => setFormeJuridique(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="siret" className="text-sm font-medium text-slate-700">
            SIRET
          </label>
          <input
            id="siret"
            value={siret}
            onChange={(event) => setSiret(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sci-adresse" className="text-sm font-medium text-slate-700">
            Adresse (siège social)
          </label>
          <input
            id="sci-adresse"
            required
            value={adresse}
            onChange={(event) => setAdresse(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sci-code-postal" className="text-sm font-medium text-slate-700">
            Code postal
          </label>
          <input
            id="sci-code-postal"
            required
            value={codePostal}
            onChange={(event) => setCodePostal(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sci-ville" className="text-sm font-medium text-slate-700">
            Ville
          </label>
          <input
            id="sci-ville"
            required
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
        {isSubmitting ? "Création…" : "Créer la SCI"}
      </button>
    </form>
  );
}
