import { useCallback, useEffect, useState, type FormEvent } from "react";
import { deduireNombrePiecesDepuisType, estTypeResidentiel } from "core";
import {
  archiveAppartement,
  createAppartement,
  getBien,
  libelleBien,
  listAppartements,
  updateBien,
  BIEN_TYPE_LABELS,
  type Appartement,
  type AppartementModeProduction,
  type AppartementType,
  type Bien,
  type BienRegimeJuridique,
  type BienType,
  type BienTypeHabitat
} from "./api";
import { ARCHIVED_ROW_CLASSNAME, ArchiveBadge, ArchiveToggle } from "../components/ArchiveFilter";
import { useBreadcrumbSegments } from "../layout/breadcrumb-context";

const APPARTEMENT_TYPES: AppartementType[] = ["T1", "T2", "T3", "T4", "T5", "T6"];
const TYPES_HABITAT: BienTypeHabitat[] = ["collectif", "individuel"];
const REGIMES_JURIDIQUES: BienRegimeJuridique[] = ["mono_propriete", "copropriete"];

// Généralisé depuis ImmeubleDetailView le 2026-08-26 (migration bien,
// Étape 5) : un immeuble a N appartements ; tout autre type en a
// exactement 1, créé dès NewBienWizard — le bouton "Nouvel appartement"
// reste donc masqué pour ces types une fois ce lot unique en place.
export function BienDetailView({
  bienId,
  onBack,
  onSelectAppartement
}: {
  bienId: string;
  onBack: () => void;
  onSelectAppartement: (appartementId: string) => void;
}): React.JSX.Element {
  const [bien, setBien] = useState<Bien | null>(null);
  const [appartements, setAppartements] = useState<Appartement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showArchivedAppartements, setShowArchivedAppartements] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [bienData, appartementsData] = await Promise.all([getBien(bienId), listAppartements(bienId)]);
      setBien(bienData);
      setAppartements(appartementsData);
      setError(null);
    } catch {
      setError("Impossible de charger la fiche du bien");
    }
  }, [bienId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useBreadcrumbSegments(bien ? [libelleBien(bien)] : []);

  async function handleArchive(id: string): Promise<void> {
    await archiveAppartement(id);
    await refresh();
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }

  if (!bien) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  const estImmeuble = bien.type === "immeuble";
  const appartementsActifs = appartements.filter((a) => a.statut !== "archive");
  const peutAjouterAppartement = estImmeuble || appartementsActifs.length === 0;

  return (
    <div className="space-y-8">
      <button type="button" onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700">
        ← {"Retour"}
      </button>

      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{libelleBien(bien)}</h1>
          <button
            type="button"
            onClick={() => setIsEditing((value) => !value)}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            {isEditing ? "Annuler" : "Modifier"}
          </button>
        </div>

        {isEditing ? (
          <EditBienForm
            bien={bien}
            onSaved={() => {
              setIsEditing(false);
              void refresh();
            }}
          />
        ) : (
          <dl className="mt-2 grid grid-cols-2 gap-x-8 text-sm">
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Type</dt>
              <dd>{BIEN_TYPE_LABELS[bien.type]}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Statut</dt>
              <dd>{bien.statut}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Adresse</dt>
              <dd>{bien.adresse}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Code postal</dt>
              <dd>{bien.codePostal}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Ville</dt>
              <dd>{bien.ville}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Année de construction</dt>
              <dd>{bien.anneeConstruction ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Type d'habitat</dt>
              <dd>{bien.typeHabitat ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 py-1">
              <dt className="text-slate-500">Régime juridique</dt>
              <dd>{bien.regimeJuridique ?? "—"}</dd>
            </div>
            {estImmeuble && (
              <>
                <div className="flex justify-between border-b border-slate-100 py-1">
                  <dt className="text-slate-500">Syndic</dt>
                  <dd>{bien.syndic ?? "—"}</dd>
                </div>
                <div className="flex justify-between border-b border-slate-100 py-1">
                  <dt className="text-slate-500">Nombre de lots</dt>
                  <dd>{bien.nbLots ?? "—"}</dd>
                </div>
                <div className="flex justify-between border-b border-slate-100 py-1">
                  <dt className="text-slate-500">Charges copro annuelles</dt>
                  <dd>{bien.chargesCoproAnnuelles ?? "—"}</dd>
                </div>
              </>
            )}
          </dl>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Appartements</h2>
          <div className="flex items-center gap-4">
            <ArchiveToggle
              show={showArchivedAppartements}
              onToggle={() => setShowArchivedAppartements((value) => !value)}
            />
            {peutAjouterAppartement && (
              <button
                type="button"
                onClick={() => setShowForm((value) => !value)}
                className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
              >
                {showForm ? "Annuler" : "Nouvel appartement"}
              </button>
            )}
          </div>
        </div>

        {showForm && (
          <NewAppartementForm
            bienId={bien.id}
            bienType={bien.type}
            onCreated={() => {
              setShowForm(false);
              void refresh();
            }}
          />
        )}

        {(() => {
          const visibleAppartements = showArchivedAppartements ? appartements : appartementsActifs;
          return visibleAppartements.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Aucun appartement pour le moment.</p>
          ) : (
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 font-medium">Numéro</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Statut</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visibleAppartements.map((appartement) => (
                  <tr
                    key={appartement.id}
                    className={`border-b border-slate-100 ${appartement.statut === "archive" ? ARCHIVED_ROW_CLASSNAME : ""}`}
                  >
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => onSelectAppartement(appartement.id)}
                        className="text-indigo-700 hover:underline"
                      >
                        {appartement.numero}
                      </button>
                      {appartement.statut === "archive" && <ArchiveBadge />}
                    </td>
                    <td className="py-2">{appartement.type ?? "—"}</td>
                    <td className="py-2">{appartement.statut}</td>
                    <td className="py-2 text-right">
                      {appartement.statut !== "archive" && (
                        <button
                          type="button"
                          onClick={() => {
                            void handleArchive(appartement.id);
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

function NewAppartementForm({
  bienId,
  bienType,
  onCreated
}: {
  bienId: string;
  bienType: BienType;
  onCreated: () => void;
}): React.JSX.Element {
  // Atteignable même pour un bien non résidentiel (parking/bureau/
  // local_commercial) dans le cas où son unique appartement a été archivé
  // (peutAjouterAppartement ci-dessus) — type/nombrePiecesPrincipales/
  // modeChauffage/modeEauChaude n'ont alors pas de sens et sont rejetés par
  // AppartementsService s'ils sont fournis (packages/core,
  // estTypeResidentiel).
  const estResidentiel = estTypeResidentiel(bienType);
  const [numero, setNumero] = useState("");
  const [type, setType] = useState<AppartementType>("T2");
  const [surface, setSurface] = useState("");
  const [loyerReference, setLoyerReference] = useState("");
  const [nombrePiecesPrincipales, setNombrePiecesPrincipales] = useState(
    deduireNombrePiecesDepuisType("T2")?.toString() ?? ""
  );
  // Suivi manuel pour ne pré-remplir/resynchroniser depuis le type QUE tant
  // que le propriétaire n'a pas lui-même corrigé la suggestion — ne jamais
  // écraser une saisie explicite (docs/data-dictionary.md, appartements).
  const [nombrePiecesModifieManuellement, setNombrePiecesModifieManuellement] = useState(false);
  const [modeChauffage, setModeChauffage] = useState<AppartementModeProduction>("individuel");
  const [modeEauChaude, setModeEauChaude] = useState<AppartementModeProduction>("individuel");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleTypeChange(nouveauType: AppartementType): void {
    setType(nouveauType);
    if (!nombrePiecesModifieManuellement) {
      setNombrePiecesPrincipales(deduireNombrePiecesDepuisType(nouveauType)?.toString() ?? "");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createAppartement({
        bienId,
        numero,
        ...(estResidentiel && {
          type,
          nombrePiecesPrincipales: Number(nombrePiecesPrincipales),
          modeChauffage,
          modeEauChaude
        }),
        ...(surface && { surface }),
        ...(loyerReference && { loyerReference })
      });
      setNumero("");
      setSurface("");
      setLoyerReference("");
      setNombrePiecesPrincipales(deduireNombrePiecesDepuisType(type)?.toString() ?? "");
      setNombrePiecesModifieManuellement(false);
      onCreated();
    } catch {
      setError("Impossible de créer l'appartement");
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
          <label htmlFor="appartement-numero" className="text-sm font-medium text-slate-700">
            Numéro
          </label>
          <input
            id="appartement-numero"
            required
            value={numero}
            onChange={(event) => setNumero(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {estResidentiel && (
          <div className="space-y-1">
            <label htmlFor="appartement-type" className="text-sm font-medium text-slate-700">
              Type
            </label>
            <select
              id="appartement-type"
              value={type}
              onChange={(event) => handleTypeChange(event.target.value as AppartementType)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {APPARTEMENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="appartement-surface" className="text-sm font-medium text-slate-700">
            Surface (m²)
          </label>
          <input
            id="appartement-surface"
            value={surface}
            onChange={(event) => setSurface(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="appartement-loyer" className="text-sm font-medium text-slate-700">
            Loyer de référence
          </label>
          <input
            id="appartement-loyer"
            value={loyerReference}
            onChange={(event) => setLoyerReference(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {estResidentiel && (
          <>
            <div className="space-y-1">
              <label htmlFor="appartement-nombre-pieces" className="text-sm font-medium text-slate-700">
                Nombre de pièces principales
              </label>
              <input
                id="appartement-nombre-pieces"
                type="number"
                min={1}
                required
                value={nombrePiecesPrincipales}
                onChange={(event) => {
                  setNombrePiecesModifieManuellement(true);
                  setNombrePiecesPrincipales(event.target.value);
                }}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="appartement-chauffage" className="text-sm font-medium text-slate-700">
                Chauffage
              </label>
              <select
                id="appartement-chauffage"
                value={modeChauffage}
                onChange={(event) => setModeChauffage(event.target.value as AppartementModeProduction)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="individuel">Individuel</option>
                <option value="collectif">Collectif</option>
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="appartement-eau-chaude" className="text-sm font-medium text-slate-700">
                Eau chaude
              </label>
              <select
                id="appartement-eau-chaude"
                value={modeEauChaude}
                onChange={(event) => setModeEauChaude(event.target.value as AppartementModeProduction)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="individuel">Individuelle</option>
                <option value="collectif">Collective</option>
              </select>
            </div>
          </>
        )}
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
        {isSubmitting ? "Création…" : "Créer l'appartement"}
      </button>
    </form>
  );
}

function EditBienForm({ bien, onSaved }: { bien: Bien; onSaved: () => void }): React.JSX.Element {
  const estImmeuble = bien.type === "immeuble";
  const estMaison = bien.type === "maison";

  const [nom, setNom] = useState(bien.nom ?? "");
  const [adresse, setAdresse] = useState(bien.adresse);
  const [codePostal, setCodePostal] = useState(bien.codePostal);
  const [ville, setVille] = useState(bien.ville);
  const [anneeConstruction, setAnneeConstruction] = useState(bien.anneeConstruction?.toString() ?? "");
  const [typeHabitat, setTypeHabitat] = useState<BienTypeHabitat | "">(bien.typeHabitat ?? "");
  const [regimeJuridique, setRegimeJuridique] = useState<BienRegimeJuridique | "">(bien.regimeJuridique ?? "");
  const [syndic, setSyndic] = useState(bien.syndic ?? "");
  const [nbLots, setNbLots] = useState(bien.nbLots?.toString() ?? "");
  const [chargesCoproAnnuelles, setChargesCoproAnnuelles] = useState(bien.chargesCoproAnnuelles ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await updateBien(bien.id, {
        ...(nom && { nom }),
        adresse,
        codePostal,
        ville,
        ...(anneeConstruction && { anneeConstruction: Number(anneeConstruction) }),
        ...(!estMaison && typeHabitat && { typeHabitat }),
        ...(!estMaison && regimeJuridique && { regimeJuridique }),
        ...(estImmeuble && syndic && { syndic }),
        ...(estImmeuble && nbLots && { nbLots: Number(nbLots) }),
        ...(estImmeuble && chargesCoproAnnuelles && { chargesCoproAnnuelles })
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
          <label htmlFor="bien-edit-nom" className="text-sm font-medium text-slate-700">
            Nom {estImmeuble ? "" : "(optionnel)"}
          </label>
          <input
            id="bien-edit-nom"
            required={estImmeuble}
            value={nom}
            onChange={(event) => setNom(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bien-edit-adresse" className="text-sm font-medium text-slate-700">
            Adresse
          </label>
          <input
            id="bien-edit-adresse"
            required
            value={adresse}
            onChange={(event) => setAdresse(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bien-edit-code-postal" className="text-sm font-medium text-slate-700">
            Code postal
          </label>
          <input
            id="bien-edit-code-postal"
            required
            value={codePostal}
            onChange={(event) => setCodePostal(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bien-edit-ville" className="text-sm font-medium text-slate-700">
            Ville
          </label>
          <input
            id="bien-edit-ville"
            required
            value={ville}
            onChange={(event) => setVille(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bien-edit-annee-construction" className="text-sm font-medium text-slate-700">
            Année de construction
          </label>
          <input
            id="bien-edit-annee-construction"
            type="number"
            min={1800}
            max={2100}
            value={anneeConstruction}
            onChange={(event) => setAnneeConstruction(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {!estMaison && (
          <>
            <div className="space-y-1">
              <label htmlFor="bien-edit-type-habitat" className="text-sm font-medium text-slate-700">
                Type d'habitat
              </label>
              <select
                id="bien-edit-type-habitat"
                value={typeHabitat}
                onChange={(event) => setTypeHabitat(event.target.value as BienTypeHabitat | "")}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Non renseigné</option>
                {TYPES_HABITAT.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="bien-edit-regime-juridique" className="text-sm font-medium text-slate-700">
                Régime juridique
              </label>
              <select
                id="bien-edit-regime-juridique"
                value={regimeJuridique}
                onChange={(event) => setRegimeJuridique(event.target.value as BienRegimeJuridique | "")}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Non renseigné</option>
                {REGIMES_JURIDIQUES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {estImmeuble && (
          <>
            <div className="space-y-1">
              <label htmlFor="bien-edit-syndic" className="text-sm font-medium text-slate-700">
                Syndic
              </label>
              <input
                id="bien-edit-syndic"
                value={syndic}
                onChange={(event) => setSyndic(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="bien-edit-nb-lots" className="text-sm font-medium text-slate-700">
                Nombre de lots
              </label>
              <input
                id="bien-edit-nb-lots"
                type="number"
                min={1}
                value={nbLots}
                onChange={(event) => setNbLots(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="bien-edit-charges-copro" className="text-sm font-medium text-slate-700">
                Charges copro annuelles
              </label>
              <input
                id="bien-edit-charges-copro"
                value={chargesCoproAnnuelles}
                onChange={(event) => setChargesCoproAnnuelles(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </>
        )}
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
