import { useCallback, useEffect, useState, type FormEvent } from "react";
import { archiveSci, createSci, listScis, type CreateSciInput, type Sci } from "../scis/api";
import { archiveBien, libelleBien, listBiens, BIEN_TYPE_LABELS, type Bien } from "./api";
import { NewBienWizard } from "./NewBienWizard";
import { ARCHIVED_ROW_CLASSNAME, ArchiveBadge, ArchiveToggle } from "../components/ArchiveFilter";

export function ScisListView({
  onSelect,
  onSelectBien
}: {
  onSelect: (sciId: string) => void;
  onSelectBien: (bienId: string) => void;
}): React.JSX.Element {
  const [scis, setScis] = useState<Sci[]>([]);
  const [biensNomPropre, setBiensNomPropre] = useState<Bien[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSciForm, setShowSciForm] = useState(false);
  const [showBienWizard, setShowBienWizard] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [toutesScis, tousBiens] = await Promise.all([listScis(), listBiens()]);
      setScis(toutesScis);
      // Un bien en nom propre (proprietaireType='personne_physique') n'a
      // aucune SCI parente : c'est le seul endroit où il apparaît dans la
      // navigation (docs/backlog.md, migration bien, Étape 5).
      setBiensNomPropre(tousBiens.filter((bien) => bien.proprietaireType === "personne_physique"));
      setError(null);
    } catch {
      setError("Impossible de charger le patrimoine");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleArchiveSci(id: string): Promise<void> {
    await archiveSci(id);
    await refresh();
  }

  async function handleArchiveBien(id: string): Promise<void> {
    await archiveBien(id);
    await refresh();
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Patrimoine</h1>
        <div className="flex items-center gap-4">
          <ArchiveToggle show={showArchived} onToggle={() => setShowArchived((value) => !value)} />
          <button
            type="button"
            onClick={() => setShowBienWizard((value) => !value)}
            className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            {showBienWizard ? "Annuler" : "Nouveau bien"}
          </button>
        </div>
      </div>

      {showBienWizard && (
        // Pas de sciId présélectionné ici (contrairement au même flux lancé
        // depuis SciDetailView) : le propriétaire (SCI ou nom propre) se
        // choisit à l'étape 1 sans valeur par défaut.
        <NewBienWizard
          onCreated={() => {
            setShowBienWizard(false);
            void refresh();
          }}
          onCancel={() => setShowBienWizard(false)}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">SCI</h2>
          <button
            type="button"
            onClick={() => setShowSciForm((value) => !value)}
            className="text-sm text-indigo-700 hover:text-indigo-800"
          >
            {showSciForm ? "Annuler" : "+ Nouvelle SCI"}
          </button>
        </div>

        {showSciForm && (
          <NewSciForm
            onCreated={() => {
              setShowSciForm(false);
              void refresh();
            }}
          />
        )}

        {(() => {
          const visibleScis = showArchived ? scis : scis.filter((sci) => sci.statut !== "archive");
          return isLoading ? (
            <p className="mt-2 text-sm text-slate-500">Chargement…</p>
          ) : visibleScis.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Aucune SCI pour le moment.</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm">
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
                            void handleArchiveSci(sci.id);
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
        <h2 className="text-sm font-semibold text-slate-700">Biens en nom propre</h2>
        {(() => {
          const visibleBiens = showArchived
            ? biensNomPropre
            : biensNomPropre.filter((bien) => bien.statut !== "archive");
          return isLoading ? null : visibleBiens.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Aucun bien en nom propre pour le moment.</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 font-medium">Nom</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Adresse</th>
                  <th className="py-2 font-medium">Statut</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visibleBiens.map((bien) => (
                  <tr
                    key={bien.id}
                    className={`border-b border-slate-100 ${bien.statut === "archive" ? ARCHIVED_ROW_CLASSNAME : ""}`}
                  >
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => onSelectBien(bien.id)}
                        className="text-indigo-700 hover:underline"
                      >
                        {libelleBien(bien)}
                      </button>
                      {bien.statut === "archive" && <ArchiveBadge />}
                    </td>
                    <td className="py-2">{BIEN_TYPE_LABELS[bien.type]}</td>
                    <td className="py-2">
                      {bien.adresse}
                      {bien.ville ? `, ${bien.ville}` : ""}
                    </td>
                    <td className="py-2">{bien.statut}</td>
                    <td className="py-2 text-right">
                      {bien.statut === "actif" && (
                        <button
                          type="button"
                          onClick={() => {
                            void handleArchiveBien(bien.id);
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
      className="mt-2 space-y-4 rounded-lg border border-slate-200 p-4"
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
