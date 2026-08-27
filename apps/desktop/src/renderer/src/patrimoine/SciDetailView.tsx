import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createCompteBancaire,
  getSci,
  listComptesBancaires,
  updateSci,
  type CompteBancaire,
  type RegimeFiscal,
  type Sci
} from "../scis/api";
import { archiveBien, libelleBien, listBiens, BIEN_TYPE_LABELS, type Bien } from "./api";
import { NewBienWizard } from "./NewBienWizard";
import { ARCHIVED_ROW_CLASSNAME, ArchiveBadge, ArchiveToggle } from "../components/ArchiveFilter";
import { useBreadcrumbSegments } from "../layout/breadcrumb-context";

export function SciDetailView({
  sciId,
  onBack,
  onSelectBien
}: {
  sciId: string;
  onBack: () => void;
  onSelectBien: (bienId: string) => void;
}): React.JSX.Element {
  const [sci, setSci] = useState<Sci | null>(null);
  const [comptes, setComptes] = useState<CompteBancaire[]>([]);
  const [biens, setBiens] = useState<Bien[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCompteForm, setShowCompteForm] = useState(false);
  const [showBienWizard, setShowBienWizard] = useState(false);
  const [showArchivedBiens, setShowArchivedBiens] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      // Le compte bancaire est lu via l'endpoint dédié qui renvoie l'IBAN
      // déjà déchiffré côté backend — jamais de déchiffrement local ici.
      const [sciData, comptesData, biensData] = await Promise.all([
        getSci(sciId),
        listComptesBancaires(sciId),
        listBiens(sciId)
      ]);
      setSci(sciData);
      setComptes(comptesData);
      setBiens(biensData);
      setError(null);
    } catch {
      setError("Impossible de charger la fiche SCI");
    }
  }, [sciId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useBreadcrumbSegments(sci ? [sci.nom] : []);

  async function handleArchiveBien(id: string): Promise<void> {
    await archiveBien(id);
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
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{sci.nom}</h1>
          <button
            type="button"
            onClick={() => setIsEditing((value) => !value)}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            {isEditing ? "Annuler" : "Modifier"}
          </button>
        </div>

        {isEditing ? (
          <EditSciForm
            sci={sci}
            onSaved={() => {
              setIsEditing(false);
              void refresh();
            }}
          />
        ) : (
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
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Adresse</dt>
              <dd>{sci.adresse ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Code postal</dt>
              <dd>{sci.codePostal ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Ville</dt>
              <dd>{sci.ville ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Téléphone</dt>
              <dd>{sci.telephone ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">SCI familiale</dt>
              <dd>{sci.estFamiliale === null ? "Non renseigné" : sci.estFamiliale ? "Oui" : "Non"}</dd>
            </div>
          </dl>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Biens</h2>
          <div className="flex items-center gap-4">
            <ArchiveToggle show={showArchivedBiens} onToggle={() => setShowArchivedBiens((value) => !value)} />
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
          // sciId présélectionné à l'étape 1 (Propriétaire) puisqu'on est
          // déjà dans le contexte de cette SCI — reste modifiable, même
          // flux qu'à partir de ScisListView (docs/backlog.md, migration
          // bien, Étape 5).
          <NewBienWizard
            sciIdPreselectionne={sci.id}
            onCreated={() => {
              setShowBienWizard(false);
              void refresh();
            }}
            onCancel={() => setShowBienWizard(false)}
          />
        )}

        {(() => {
          const visibleBiens = showArchivedBiens ? biens : biens.filter((bien) => bien.statut !== "archive");
          return visibleBiens.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Aucun bien pour le moment.</p>
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

const REGIMES_FISCAUX: RegimeFiscal[] = ["IS", "IR"];

// "" = non renseigné (null en base) — distinct de "false", jamais
// pré-sélectionné par défaut (docs/data-dictionary.md).
type EstFamilialeChoix = "" | "true" | "false";

function EditSciForm({ sci, onSaved }: { sci: Sci; onSaved: () => void }): React.JSX.Element {
  const [nom, setNom] = useState(sci.nom);
  const [regimeFiscal, setRegimeFiscal] = useState<RegimeFiscal>(sci.regimeFiscal);
  const [formeJuridique, setFormeJuridique] = useState(sci.formeJuridique ?? "");
  const [siret, setSiret] = useState(sci.siret ?? "");
  const [adresse, setAdresse] = useState(sci.adresse ?? "");
  const [codePostal, setCodePostal] = useState(sci.codePostal ?? "");
  const [ville, setVille] = useState(sci.ville ?? "");
  const [telephone, setTelephone] = useState(sci.telephone ?? "");
  const [estFamiliale, setEstFamiliale] = useState<EstFamilialeChoix>(
    sci.estFamiliale === null ? "" : sci.estFamiliale ? "true" : "false"
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await updateSci(sci.id, {
        nom,
        regimeFiscal,
        ...(formeJuridique && { formeJuridique }),
        ...(siret && { siret }),
        ...(adresse && { adresse }),
        ...(codePostal && { codePostal }),
        ...(ville && { ville }),
        ...(telephone && { telephone }),
        ...(estFamiliale !== "" && { estFamiliale: estFamiliale === "true" })
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
      className="mt-2 space-y-4 rounded-lg border border-slate-200 p-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="sci-edit-nom" className="text-sm font-medium text-slate-700">
            Nom
          </label>
          <input
            id="sci-edit-nom"
            required
            value={nom}
            onChange={(event) => setNom(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sci-edit-regime" className="text-sm font-medium text-slate-700">
            Régime fiscal
          </label>
          <select
            id="sci-edit-regime"
            value={regimeFiscal}
            onChange={(event) => setRegimeFiscal(event.target.value as RegimeFiscal)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {REGIMES_FISCAUX.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="sci-edit-forme-juridique" className="text-sm font-medium text-slate-700">
            Forme juridique
          </label>
          <input
            id="sci-edit-forme-juridique"
            value={formeJuridique}
            onChange={(event) => setFormeJuridique(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sci-edit-siret" className="text-sm font-medium text-slate-700">
            SIRET
          </label>
          <input
            id="sci-edit-siret"
            value={siret}
            onChange={(event) => setSiret(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sci-edit-adresse" className="text-sm font-medium text-slate-700">
            Adresse (siège social)
          </label>
          <input
            id="sci-edit-adresse"
            value={adresse}
            onChange={(event) => setAdresse(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sci-edit-code-postal" className="text-sm font-medium text-slate-700">
            Code postal
          </label>
          <input
            id="sci-edit-code-postal"
            value={codePostal}
            onChange={(event) => setCodePostal(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sci-edit-ville" className="text-sm font-medium text-slate-700">
            Ville
          </label>
          <input
            id="sci-edit-ville"
            value={ville}
            onChange={(event) => setVille(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sci-edit-telephone" className="text-sm font-medium text-slate-700">
            Téléphone
          </label>
          <input
            id="sci-edit-telephone"
            value={telephone}
            onChange={(event) => setTelephone(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sci-edit-est-familiale" className="text-sm font-medium text-slate-700">
            SCI familiale
          </label>
          <select
            id="sci-edit-est-familiale"
            value={estFamiliale}
            onChange={(event) => setEstFamiliale(event.target.value as EstFamilialeChoix)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Non renseigné</option>
            <option value="true">Oui</option>
            <option value="false">Non</option>
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
