import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ARCHIVED_ROW_CLASSNAME, ArchiveBadge, ArchiveToggle } from "../components/ArchiveFilter";
import { archiveLocataire, createLocataire, listLocataires, type Locataire } from "./api";

export function LocatairesListView({
  onSelect
}: {
  onSelect: (locataireId: string) => void;
}): React.JSX.Element {
  const [locataires, setLocataires] = useState<Locataire[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setLocataires(await listLocataires());
      setError(null);
    } catch {
      setError("Impossible de charger les locataires");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleArchive(id: string): Promise<void> {
    await archiveLocataire(id);
    await refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Locataires</h1>
        <div className="flex items-center gap-4">
          <ArchiveToggle show={showArchived} onToggle={() => setShowArchived((value) => !value)} />
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            {showForm ? "Annuler" : "Nouveau locataire"}
          </button>
        </div>
      </div>

      {showForm && (
        <NewLocataireForm
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
        const visibleLocataires = showArchived
          ? locataires
          : locataires.filter((locataire) => locataire.statut !== "archive");
        return isLoading ? (
          <p className="text-sm text-slate-500">Chargement…</p>
        ) : visibleLocataires.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun locataire pour le moment.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 font-medium">Nom</th>
                <th className="py-2 font-medium">Email</th>
                <th className="py-2 font-medium">Statut</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {visibleLocataires.map((locataire) => (
                <tr
                  key={locataire.id}
                  className={`border-b border-slate-100 ${
                    locataire.statut === "archive" ? ARCHIVED_ROW_CLASSNAME : ""
                  }`}
                >
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => onSelect(locataire.id)}
                      className="text-indigo-700 hover:underline"
                    >
                      {locataire.prenom} {locataire.nom}
                    </button>
                    {locataire.statut === "archive" && <ArchiveBadge />}
                  </td>
                  <td className="py-2">{locataire.email ?? "—"}</td>
                  <td className="py-2">{locataire.statut}</td>
                  <td className="py-2 text-right">
                    {locataire.statut !== "archive" && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleArchive(locataire.id);
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

function NewLocataireForm({ onCreated }: { onCreated: () => void }): React.JSX.Element {
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [email, setEmail] = useState("");
  const [telephone, setTelephone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createLocataire({
        nom,
        prenom,
        ...(email && { email }),
        ...(telephone && { telephone })
      });
      setNom("");
      setPrenom("");
      setEmail("");
      setTelephone("");
      onCreated();
    } catch {
      setError("Impossible de créer le locataire");
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
          <label htmlFor="locataire-nom" className="text-sm font-medium text-slate-700">
            Nom
          </label>
          <input
            id="locataire-nom"
            required
            value={nom}
            onChange={(event) => setNom(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="locataire-prenom" className="text-sm font-medium text-slate-700">
            Prénom
          </label>
          <input
            id="locataire-prenom"
            required
            value={prenom}
            onChange={(event) => setPrenom(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="locataire-email" className="text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="locataire-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="locataire-telephone" className="text-sm font-medium text-slate-700">
            Téléphone
          </label>
          <input
            id="locataire-telephone"
            value={telephone}
            onChange={(event) => setTelephone(event.target.value)}
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
        {isSubmitting ? "Création…" : "Créer le locataire"}
      </button>
    </form>
  );
}
