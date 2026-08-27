import { useEffect, useState, type FormEvent } from "react";
import { deduireNombrePiecesDepuisType, estTypeResidentiel } from "core";
import { listScis, type Sci } from "../scis/api";
import {
  createAppartement,
  createBien,
  BIEN_TYPES,
  BIEN_TYPE_LABELS,
  type AppartementModeProduction,
  type AppartementType,
  type Bien,
  type BienProprietaireType,
  type BienRegimeJuridique,
  type BienType,
  type BienTypeHabitat
} from "./api";

const APPARTEMENT_TYPES: AppartementType[] = ["T1", "T2", "T3", "T4", "T5", "T6"];
const TYPES_HABITAT: BienTypeHabitat[] = ["collectif", "individuel"];
const REGIMES_JURIDIQUES: BienRegimeJuridique[] = ["mono_propriete", "copropriete"];

type Etape = "proprietaire" | "type" | "details";

// Flux de création unifié (propriétaire -> type -> détails), lancé depuis
// ScisListView (sciId non présélectionné) et SciDetailView (sciId de la
// SCI courante présélectionné à l'étape 1, mais toujours modifiable — même
// flux partout, seule la valeur par défaut change). Un immeuble a N
// appartements (ajoutés ensuite depuis BienDetailView, comme aujourd'hui) ;
// tout autre type en a exactement 1, créé ici même dans la même étape
// puisqu'un tel bien sans son unique appartement n'a pas vraiment de sens.
export function NewBienWizard({
  sciIdPreselectionne,
  onCreated,
  onCancel
}: {
  sciIdPreselectionne?: string;
  onCreated: (bien: Bien) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [etape, setEtape] = useState<Etape>("proprietaire");
  const [scis, setScis] = useState<Sci[]>([]);
  const [proprietaireType, setProprietaireType] = useState<BienProprietaireType>("sci");
  const [sciId, setSciId] = useState(sciIdPreselectionne ?? "");
  const [type, setType] = useState<BienType>("immeuble");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void listScis().then((toutes) => setScis(toutes.filter((sci) => sci.statut !== "archive")));
  }, []);

  function handleEtapeProprietaireSuivant(): void {
    if (proprietaireType === "sci" && !sciId) {
      setError("Choisissez une SCI.");
      return;
    }
    setError(null);
    setEtape("type");
  }

  return (
    <div className="mt-2 space-y-4 rounded-lg border border-slate-200 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
        <span className={etape === "proprietaire" ? "text-indigo-700" : ""}>1. Propriétaire</span>
        <span>→</span>
        <span className={etape === "type" ? "text-indigo-700" : ""}>2. Type</span>
        <span>→</span>
        <span className={etape === "details" ? "text-indigo-700" : ""}>3. Détails</span>
      </div>

      {etape === "proprietaire" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Propriétaire</label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="proprietaireType"
                  checked={proprietaireType === "sci"}
                  onChange={() => setProprietaireType("sci")}
                />
                Une SCI
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="proprietaireType"
                  checked={proprietaireType === "personne_physique"}
                  onChange={() => setProprietaireType("personne_physique")}
                />
                En nom propre
              </label>
            </div>
          </div>

          {proprietaireType === "sci" && (
            <div className="space-y-1">
              <label htmlFor="bien-sci" className="text-sm font-medium text-slate-700">
                SCI
              </label>
              <select
                id="bien-sci"
                value={sciId}
                onChange={(event) => setSciId(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Choisir une SCI…</option>
                {scis.map((sci) => (
                  <option key={sci.id} value={sci.id}>
                    {sci.nom}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="flex justify-between">
            <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700">
              Annuler
            </button>
            <button
              type="button"
              onClick={handleEtapeProprietaireSuivant}
              className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
            >
              Suivant
            </button>
          </div>
        </div>
      )}

      {etape === "type" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Type de bien</label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {BIEN_TYPES.map((value) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="bienType"
                    checked={type === value}
                    onChange={() => setType(value)}
                  />
                  {BIEN_TYPE_LABELS[value]}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setEtape("proprietaire")}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              ← Précédent
            </button>
            <button
              type="button"
              onClick={() => setEtape("details")}
              className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
            >
              Suivant
            </button>
          </div>
        </div>
      )}

      {etape === "details" && (
        <DetailsStep
          type={type}
          proprietaireType={proprietaireType}
          sciId={proprietaireType === "sci" ? sciId : undefined}
          onPrecedent={() => setEtape("type")}
          onCancel={onCancel}
          onCreated={onCreated}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
        />
      )}
    </div>
  );
}

function DetailsStep({
  type,
  proprietaireType,
  sciId,
  onPrecedent,
  onCancel,
  onCreated,
  isSubmitting,
  setIsSubmitting
}: {
  type: BienType;
  proprietaireType: BienProprietaireType;
  sciId?: string;
  onPrecedent: () => void;
  onCancel: () => void;
  onCreated: (bien: Bien) => void;
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
}): React.JSX.Element {
  const estImmeuble = type === "immeuble";
  const estMaison = type === "maison";
  // Un immeuble n'a pas d'appartement unique créé ici (voir plus haut) ;
  // parmi les autres types, seuls maison/appartement_isole sont des
  // logements d'habitation — parking/bureau/local_commercial n'ont ni
  // type T1-T6, ni chauffage, ni eau chaude, ni mode de production
  // d'énergie (packages/core, estTypeResidentiel — cohérent avec le rejet
  // strict désormais en place côté backend, AppartementsService).
  const estLotResidentiel = !estImmeuble && estTypeResidentiel(type);

  const [nom, setNom] = useState("");
  const [adresse, setAdresse] = useState("");
  const [codePostal, setCodePostal] = useState("");
  const [ville, setVille] = useState("");
  const [anneeConstruction, setAnneeConstruction] = useState("");
  const [typeHabitat, setTypeHabitat] = useState<BienTypeHabitat>("collectif");
  const [regimeJuridique, setRegimeJuridique] = useState<BienRegimeJuridique>("copropriete");
  const [syndic, setSyndic] = useState("");
  const [nbLots, setNbLots] = useState("");
  const [chargesCoproAnnuelles, setChargesCoproAnnuelles] = useState("");

  // Champs du lot unique, non pertinents pour un immeuble (ses appartements
  // s'ajoutent ensuite depuis sa fiche, comme aujourd'hui).
  const [appartementNumero, setAppartementNumero] = useState("unique");
  const [appartementType, setAppartementType] = useState<AppartementType>("T2");
  const [nombrePiecesPrincipales, setNombrePiecesPrincipales] = useState(
    deduireNombrePiecesDepuisType("T2")?.toString() ?? ""
  );
  const [nombrePiecesModifieManuellement, setNombrePiecesModifieManuellement] = useState(false);
  const [modeChauffage, setModeChauffage] = useState<AppartementModeProduction>("individuel");
  const [modeEauChaude, setModeEauChaude] = useState<AppartementModeProduction>("individuel");

  const [error, setError] = useState<string | null>(null);

  function handleAppartementTypeChange(nouveauType: AppartementType): void {
    setAppartementType(nouveauType);
    if (!nombrePiecesModifieManuellement) {
      setNombrePiecesPrincipales(deduireNombrePiecesDepuisType(nouveauType)?.toString() ?? "");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (estImmeuble && !nom) {
      setError("Le nom est requis pour un immeuble.");
      return;
    }
    setIsSubmitting(true);
    try {
      const bien = await createBien({
        type,
        proprietaireType,
        ...(sciId && { sciId }),
        adresse,
        codePostal,
        ville,
        ...(nom && { nom }),
        ...(anneeConstruction && { anneeConstruction: Number(anneeConstruction) }),
        ...(!estMaison && { typeHabitat, regimeJuridique }),
        ...(estImmeuble && syndic && { syndic }),
        ...(estImmeuble && nbLots && { nbLots: Number(nbLots) }),
        ...(estImmeuble && chargesCoproAnnuelles && { chargesCoproAnnuelles })
      });

      if (!estImmeuble) {
        await createAppartement({
          bienId: bien.id,
          numero: appartementNumero,
          ...(estLotResidentiel && {
            type: appartementType,
            nombrePiecesPrincipales: Number(nombrePiecesPrincipales),
            modeChauffage,
            modeEauChaude
          })
        });
      }

      onCreated(bien);
    } catch {
      setError("Impossible de créer le bien");
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
          <label htmlFor="bien-nom" className="text-sm font-medium text-slate-700">
            Nom {estImmeuble ? "" : "(optionnel)"}
          </label>
          <input
            id="bien-nom"
            required={estImmeuble}
            value={nom}
            onChange={(event) => setNom(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bien-adresse" className="text-sm font-medium text-slate-700">
            Adresse
          </label>
          <input
            id="bien-adresse"
            required
            value={adresse}
            onChange={(event) => setAdresse(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bien-code-postal" className="text-sm font-medium text-slate-700">
            Code postal
          </label>
          <input
            id="bien-code-postal"
            required
            value={codePostal}
            onChange={(event) => setCodePostal(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bien-ville" className="text-sm font-medium text-slate-700">
            Ville
          </label>
          <input
            id="bien-ville"
            required
            value={ville}
            onChange={(event) => setVille(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="bien-annee-construction" className="text-sm font-medium text-slate-700">
            Année de construction
          </label>
          <input
            id="bien-annee-construction"
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
              <label htmlFor="bien-type-habitat" className="text-sm font-medium text-slate-700">
                Type d'habitat
              </label>
              <select
                id="bien-type-habitat"
                value={typeHabitat}
                onChange={(event) => setTypeHabitat(event.target.value as BienTypeHabitat)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {TYPES_HABITAT.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="bien-regime-juridique" className="text-sm font-medium text-slate-700">
                Régime juridique
              </label>
              <select
                id="bien-regime-juridique"
                value={regimeJuridique}
                onChange={(event) => setRegimeJuridique(event.target.value as BienRegimeJuridique)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
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
              <label htmlFor="bien-syndic" className="text-sm font-medium text-slate-700">
                Syndic (optionnel)
              </label>
              <input
                id="bien-syndic"
                value={syndic}
                onChange={(event) => setSyndic(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="bien-nb-lots" className="text-sm font-medium text-slate-700">
                Nombre de lots (optionnel)
              </label>
              <input
                id="bien-nb-lots"
                type="number"
                min={1}
                value={nbLots}
                onChange={(event) => setNbLots(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="bien-charges-copro" className="text-sm font-medium text-slate-700">
                Charges copro annuelles (optionnel)
              </label>
              <input
                id="bien-charges-copro"
                value={chargesCoproAnnuelles}
                onChange={(event) => setChargesCoproAnnuelles(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </>
        )}
      </div>

      {!estImmeuble && (
        <div className="space-y-2 rounded-md border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Le lot (ce type de bien n'a qu'un seul lot)
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="bien-appt-numero" className="text-sm font-medium text-slate-700">
                Numéro
              </label>
              <input
                id="bien-appt-numero"
                required
                value={appartementNumero}
                onChange={(event) => setAppartementNumero(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {estLotResidentiel && (
              <>
                <div className="space-y-1">
                  <label htmlFor="bien-appt-type" className="text-sm font-medium text-slate-700">
                    Type
                  </label>
                  <select
                    id="bien-appt-type"
                    value={appartementType}
                    onChange={(event) => handleAppartementTypeChange(event.target.value as AppartementType)}
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
                  <label htmlFor="bien-appt-nombre-pieces" className="text-sm font-medium text-slate-700">
                    Nombre de pièces principales
                  </label>
                  <input
                    id="bien-appt-nombre-pieces"
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
                  <label htmlFor="bien-appt-chauffage" className="text-sm font-medium text-slate-700">
                    Chauffage
                  </label>
                  <select
                    id="bien-appt-chauffage"
                    value={modeChauffage}
                    onChange={(event) => setModeChauffage(event.target.value as AppartementModeProduction)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="individuel">Individuel</option>
                    <option value="collectif">Collectif</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="bien-appt-eau-chaude" className="text-sm font-medium text-slate-700">
                    Eau chaude
                  </label>
                  <select
                    id="bien-appt-eau-chaude"
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
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex justify-between">
        <div className="flex gap-4">
          <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700">
            Annuler
          </button>
          <button type="button" onClick={onPrecedent} className="text-sm text-slate-500 hover:text-slate-700">
            ← Précédent
          </button>
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {isSubmitting ? "Création…" : "Créer le bien"}
        </button>
      </div>
    </form>
  );
}
