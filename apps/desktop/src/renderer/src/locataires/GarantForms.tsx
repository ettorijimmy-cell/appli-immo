import { useState, type FormEvent } from "react";
import { uploadDocument } from "../documents/api";
import { ApiError } from "../lib/authenticated-fetch";
import { createGarant, updateGarant, type Garant, type GarantTypeSaisissable } from "./api";
import {
  cautionDeObligatoire,
  champsGarantDepuis,
  champsGarantVides,
  changerTypeGarant,
  confirmationChangementType,
  creationGarant,
  GARANT_TYPES_SAISISSABLES,
  LIBELLES_TYPE_GARANTIE,
  MENTION_PLUS_AU_BAIL,
  MESSAGE_TYPE_AUTRE,
  modificationGarant,
  NOM_GARANT_VISALE,
  optionsCautionDe,
  RAPPEL_CONTRAT_VISALE,
  type ChampsGarant,
  type LocataireDuBail,
  type OptionCautionDe
} from "./garant-formulaire";

// Formulaires d'ajout et de modification d'un garant, partagés par la fiche
// locataire (LocataireDetailView.tsx) et l'onglet « Bail actuel »
// (patrimoine/BailTabs.tsx), qui en avaient chacun une copie jusqu'au
// 2026-11-07. `idPrefix` conserve les id DOM que portait la copie de
// l'onglet « Bail actuel » (ex. "bail-garant-nom") ; sans lui, aucun id.
// « Caution de » (2026-11-08) : locataire du bail dont le garant se porte
// caution, choisi parmi `locatairesDuBail` (liens non archivés) ;
// « Non précisé » par défaut, sauf depuis la fiche d'un locataire où la
// création est préremplie avec ce locataire (`locataireIdParDefaut`).
// Types (chantier garants, 2026-11-08) : caution personne physique ou
// garantie Visale ; une garantie Visale ne demande que le numéro de
// contrat, l'e-mail et le téléphone, et rappelle le contrat (PDF) à joindre.

const CLASSE_CHAMP = "rounded-md border border-slate-300 px-2 py-1 text-sm";

function ChampsGarantFormulaire({
  champs,
  onChange,
  optionsCaution,
  cautionObligatoire,
  fichierContrat,
  onFichierContrat,
  idPrefix
}: {
  champs: ChampsGarant;
  onChange: (champs: ChampsGarant) => void;
  optionsCaution: OptionCautionDe[];
  cautionObligatoire: boolean;
  fichierContrat: File | null;
  onFichierContrat: (fichier: File | null) => void;
  idPrefix?: string | undefined;
}): React.JSX.Element {
  const id = (suffixe: string): string | undefined => (idPrefix ? `${idPrefix}-${suffixe}` : undefined);
  const modifier = (modif: Partial<ChampsGarant>): void => onChange({ ...champs, ...modif });
  const estVisale = champs.typeGarantie === "garantie_visale";

  const selectType = (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <span className="whitespace-nowrap">Type</span>
      <select
        id={id("type")}
        value={champs.typeGarantie}
        onChange={(event) => onChange(changerTypeGarant(champs, event.target.value as GarantTypeSaisissable))}
        className={`${CLASSE_CHAMP} min-w-0 flex-1`}
      >
        {champs.typeGarantie === "autre" && (
          <option value="autre" disabled>
            {LIBELLES_TYPE_GARANTIE.autre}
          </option>
        )}
        {GARANT_TYPES_SAISISSABLES.map((value) => (
          <option key={value} value={value}>
            {LIBELLES_TYPE_GARANTIE[value]}
          </option>
        ))}
      </select>
    </label>
  );

  const contact = (
    <>
      <input
        id={id("email")}
        type="email"
        placeholder="Email"
        value={champs.email}
        onChange={(event) => modifier({ email: event.target.value })}
        className={CLASSE_CHAMP}
      />
      <input
        id={id("telephone")}
        placeholder="Téléphone"
        value={champs.telephone}
        onChange={(event) => modifier({ telephone: event.target.value })}
        className={CLASSE_CHAMP}
      />
    </>
  );

  if (estVisale) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {selectType}
          <p className="col-span-2 self-center text-sm text-slate-700">
            <span className="text-slate-500">Nom : </span>
            {NOM_GARANT_VISALE}
          </p>
          <input
            id={id("numero-visale")}
            placeholder="Numéro de contrat Visale"
            aria-label="Numéro de contrat Visale"
            value={champs.numeroContratVisale}
            onChange={(event) => modifier({ numeroContratVisale: event.target.value })}
            className={CLASSE_CHAMP}
          />
          {contact}
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>{RAPPEL_CONTRAT_VISALE}</span>
          <label className="cursor-pointer text-xs text-indigo-700 underline hover:text-indigo-800">
            {fichierContrat ? "Changer de fichier" : "+ Joindre le PDF"}
            <input
              id={id("contrat-visale")}
              type="file"
              accept="application/pdf,.pdf"
              aria-label="Contrat Visale (PDF)"
              className="hidden"
              onChange={(event) => {
                onFichierContrat(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </label>
          {fichierContrat && <span className="text-xs text-slate-600">{fichierContrat.name} (joint à l'enregistrement)</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {champs.typeGarantie === "autre" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{MESSAGE_TYPE_AUTRE}</p>
      )}
      <div className="grid grid-cols-3 gap-3">
        <input
          id={id("nom")}
          required
          placeholder="Nom"
          value={champs.nom}
          onChange={(event) => modifier({ nom: event.target.value })}
          className={CLASSE_CHAMP}
        />
        <input
          id={id("prenom")}
          required={champs.typeGarantie === "personne_physique"}
          placeholder="Prénom"
          value={champs.prenom}
          onChange={(event) => modifier({ prenom: event.target.value })}
          className={CLASSE_CHAMP}
        />
        {selectType}
        {contact}
        {/* Troisième cellule de la ligne : l'adresse occupe ainsi une ligne
            entière (adresse, code postal, ville). */}
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span className="whitespace-nowrap">
            Caution de
            {cautionObligatoire && <span className="text-amber-700"> (obligatoire en colocation)</span>}
          </span>
          <select
            id={id("caution-de")}
            value={champs.locataireId}
            onChange={(event) => modifier({ locataireId: event.target.value })}
            className={`${CLASSE_CHAMP} min-w-0 flex-1`}
          >
            {optionsCaution.map((option) => (
              <option key={option.valeur} value={option.valeur}>
                {option.libelle}
              </option>
            ))}
          </select>
        </label>
        <input
          id={id("adresse")}
          placeholder="Adresse"
          value={champs.adresse}
          onChange={(event) => modifier({ adresse: event.target.value })}
          className={CLASSE_CHAMP}
        />
        <input
          id={id("code-postal")}
          placeholder="Code postal"
          value={champs.codePostal}
          onChange={(event) => modifier({ codePostal: event.target.value })}
          className={CLASSE_CHAMP}
        />
        <input
          id={id("ville")}
          placeholder="Ville"
          value={champs.ville}
          onChange={(event) => modifier({ ville: event.target.value })}
          className={CLASSE_CHAMP}
        />
        <input
          id={id("date-naissance")}
          type="date"
          placeholder="Date de naissance"
          value={champs.dateNaissance}
          onChange={(event) => modifier({ dateNaissance: event.target.value })}
          className={CLASSE_CHAMP}
        />
        <input
          id={id("lieu-naissance")}
          placeholder="Lieu de naissance"
          value={champs.lieuNaissance}
          onChange={(event) => modifier({ lieuNaissance: event.target.value })}
          className={CLASSE_CHAMP}
        />
        <input
          id={id("nationalite")}
          placeholder="Nationalité"
          value={champs.nationalite}
          onChange={(event) => modifier({ nationalite: event.target.value })}
          className={CLASSE_CHAMP}
        />
      </div>
    </div>
  );
}

// Contrat Visale choisi dans le formulaire : envoyé après l'enregistrement
// du garant (catégorie contrat_cautionnement_visale), seulement si le type
// enregistré est bien Visale. Un échec de l'envoi ne doit pas faire
// renvoyer le formulaire (le garant est déjà enregistré) : simple alerte,
// le PDF reste à joindre depuis « Documents ».
async function joindreContratVisale(garantId: string, champs: ChampsGarant, fichier: File | null): Promise<void> {
  if (!fichier || champs.typeGarantie !== "garantie_visale") {
    return;
  }
  try {
    await uploadDocument(fichier, { entiteType: "garant", entiteId: garantId, categorie: "contrat_cautionnement_visale" });
  } catch {
    window.alert("Garant enregistré, mais le contrat Visale n'a pas pu être joint (20 Mo max). Joignez-le depuis « Documents ».");
  }
}

export function NewGarantForm({
  bailId,
  locatairesDuBail,
  locataireIdParDefaut,
  onCreated,
  idPrefix
}: {
  bailId: string;
  locatairesDuBail: readonly LocataireDuBail[];
  locataireIdParDefaut?: string;
  onCreated: () => void;
  idPrefix?: string;
}): React.JSX.Element {
  const [champs, setChamps] = useState<ChampsGarant>(() => champsGarantVides(locataireIdParDefaut));
  const [fichierContrat, setFichierContrat] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const garant = await createGarant(creationGarant(bailId, champs));
      await joindreContratVisale(garant.id, champs, fichierContrat);
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
        onChange={setChamps}
        optionsCaution={optionsCautionDe(locatairesDuBail, "", new Map())}
        cautionObligatoire={cautionDeObligatoire(locatairesDuBail)}
        fichierContrat={fichierContrat}
        onFichierContrat={setFichierContrat}
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
  locatairesDuBail,
  nomsLocataires,
  onSaved,
  onCancel
}: {
  garant: Garant;
  locatairesDuBail: readonly LocataireDuBail[];
  nomsLocataires: ReadonlyMap<string, string>;
  onSaved: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [champs, setChamps] = useState<ChampsGarant>(() => champsGarantDepuis(garant));
  const [fichierContrat, setFichierContrat] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Changement de type : le serveur vide des champs, on dit lesquels
    // avant d'enregistrer.
    const confirmation = confirmationChangementType(garant.typeGarantie, champs);
    if (confirmation !== null && !window.confirm(confirmation)) {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await updateGarant(garant.id, modificationGarant(champs));
      await joindreContratVisale(garant.id, champs, fichierContrat);
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
        onChange={setChamps}
        optionsCaution={optionsCautionDe(locatairesDuBail, garant.locataireId ?? "", nomsLocataires)}
        cautionObligatoire={cautionDeObligatoire(locatairesDuBail)}
        fichierContrat={fichierContrat}
        onFichierContrat={setFichierContrat}
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

// Nom du garant et libellé de son type, affichés dans les listes (fiche
// locataire, onglet « Bail actuel »).
export function LibelleTypeGarant({ garant }: { garant: Pick<Garant, "typeGarantie"> }): React.JSX.Element {
  return (
    <span className={garant.typeGarantie === "autre" ? "text-amber-700" : "text-slate-400"}>
      ({LIBELLES_TYPE_GARANTIE[garant.typeGarantie]})
    </span>
  );
}

// Mention « caution de X » affichée après le nom d'un garant dans les listes
// (fiche locataire, onglet « Bail actuel ») ; rien si non précisé. Texte
// calculé par mentionCautionDe (garant-formulaire.ts).
export function MentionCautionDe({ texte }: { texte: string | null }): React.JSX.Element | null {
  if (texte === null) {
    return null;
  }
  return (
    <span className={texte.endsWith(MENTION_PLUS_AU_BAIL) ? "text-amber-700" : "text-slate-500"}>
      {" "}
      — {texte}
    </span>
  );
}
