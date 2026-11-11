import { formaterDateCourteFr, formaterDateIso, LIBELLES_MODE_REMISE_BAIL, MODES_REMISE_BAIL, type ModeRemiseBail } from "core";
import { useState, type FormEvent } from "react";
import { declarerRemiseBail, type BailLocataire, type DeclarationRemiseBail, type Garant, type SuiviCaution } from "./api";
import {
  libelleEngagement,
  libelleFinEngagementColocation,
  libelleRemiseBail,
  MENTION_REMISE_NON_DECLAREE
} from "./suivi-caution";

// Date (AAAA-MM-JJ) d'un instant dans le fuseau du poste, jamais la date
// UTC : une déclaration faite à 0 h 30 porte la date du jour vécu.
function dateLocale(instant: Date): string {
  return formaterDateIso(instant.getFullYear(), instant.getMonth() + 1, instant.getDate());
}

// Suivi d'une caution personne physique, sous son nom (onglet « Bail
// actuel », fiche locataire) : fin d'engagement, puis remise du bail.
// Rien pour une garantie Visale.
export function BlocSuiviCaution({
  garant,
  suivi,
  readOnly = false,
  lienColocataireRetire = null,
  onEnregistrerConge,
  onChanged
}: {
  garant: Pick<Garant, "id" | "typeGarantie">;
  // undefined : suivi non chargé (erreur de lecture).
  suivi: SuiviCaution | undefined;
  readOnly?: boolean;
  // Colocataire garanti déjà retiré du bail (« n'est plus au bail ») : la
  // date d'effet de son congé reste saisissable et vidable ici.
  lienColocataireRetire?: BailLocataire | null;
  onEnregistrerConge?: (lienId: string, valeur: string | null) => Promise<void>;
  onChanged: () => void;
}): React.JSX.Element | null {
  if (garant.typeGarantie !== "personne_physique") {
    return null;
  }
  if (suivi === undefined) {
    return <p className="mt-1 text-xs text-slate-400">Suivi de la caution indisponible.</p>;
  }
  const finColocation = libelleFinEngagementColocation(suivi.engagement);
  return (
    <div className="mt-1 space-y-1 text-xs" aria-label="Suivi de la caution">
      <p className={suivi.engagement.dateFinEngagement === null ? "text-amber-700" : "text-slate-600"}>
        {libelleEngagement(suivi.engagement)}
      </p>
      {finColocation && <p className="text-slate-600">{finColocation}</p>}
      {!readOnly && lienColocataireRetire && onEnregistrerConge && (
        <ChampDateEffetConge
          key={`${lienColocataireRetire.id}-${lienColocataireRetire.dateEffetConge ?? ""}`}
          dateEffetConge={lienColocataireRetire.dateEffetConge}
          onEnregistrer={(valeur) => onEnregistrerConge(lienColocataireRetire.id, valeur)}
        />
      )}
      <RemiseBail garantId={garant.id} suivi={suivi} readOnly={readOnly} onChanged={onChanged} />
    </div>
  );
}

function RemiseBail({
  garantId,
  suivi,
  readOnly,
  onChanged
}: {
  garantId: string;
  suivi: SuiviCaution;
  readOnly: boolean;
  onChanged: () => void;
}): React.JSX.Element {
  const { active, historique } = suivi.remise;
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);

  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-700">Remise du bail à la caution</p>
          {active === null ? (
            <p className="text-amber-700">{MENTION_REMISE_NON_DECLAREE}</p>
          ) : (
            <p className="text-slate-600">{libelleRemiseBail(active)}</p>
          )}
        </div>
        {!readOnly && !formulaireOuvert && (
          <button
            type="button"
            onClick={() => setFormulaireOuvert(true)}
            className="shrink-0 text-indigo-700 hover:text-indigo-800"
          >
            {active === null ? "Déclarer la remise" : "Corriger"}
          </button>
        )}
      </div>

      {formulaireOuvert && (
        <FormulaireRemiseBail
          garantId={garantId}
          initiale={active}
          onAnnuler={() => setFormulaireOuvert(false)}
          onEnregistre={() => {
            setFormulaireOuvert(false);
            onChanged();
          }}
        />
      )}

      {historique.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setHistoriqueOuvert((ouvert) => !ouvert)}
            className="text-slate-500 hover:text-slate-700"
          >
            {historiqueOuvert ? "▾" : "▸"} Historique des corrections ({historique.length})
          </button>
          {historiqueOuvert && (
            <ul className="mt-1 list-disc pl-5 text-slate-500">
              {historique.map((declaration) => (
                <li key={declaration.id}>
                  {libelleRemiseBail(declaration)} — déclaré le{" "}
                  {formaterDateCourteFr(dateLocale(new Date(declaration.declareeLe)))}
                  {declaration.archivedAt && (
                    <>, remplacé le {formaterDateCourteFr(dateLocale(new Date(declaration.archivedAt)))}</>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function FormulaireRemiseBail({
  garantId,
  initiale,
  onAnnuler,
  onEnregistre
}: {
  garantId: string;
  // Déclaration active : le formulaire sert alors de correction.
  initiale: DeclarationRemiseBail | null;
  onAnnuler: () => void;
  onEnregistre: () => void;
}): React.JSX.Element {
  const aujourdHui = dateLocale(new Date());
  const [dateRemise, setDateRemise] = useState(initiale?.dateRemise ?? aujourdHui);
  const [mode, setMode] = useState<ModeRemiseBail>(initiale?.mode ?? "main_propre");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function enregistrer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await declarerRemiseBail(garantId, { dateRemise, mode });
      onEnregistre();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Impossible d'enregistrer la remise du bail");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void enregistrer(event);
      }}
      className="mt-2 flex flex-wrap items-end gap-3"
      aria-label={initiale ? "Corriger la remise du bail" : "Déclarer la remise du bail"}
    >
      <label className="flex flex-col text-slate-600">
        Date de remise
        <input
          type="date"
          required
          max={aujourdHui}
          value={dateRemise}
          onChange={(event) => setDateRemise(event.target.value)}
          className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="flex flex-col text-slate-600">
        Mode
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as ModeRemiseBail)}
          className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {MODES_REMISE_BAIL.map((valeur) => (
            <option key={valeur} value={valeur}>
              {LIBELLES_MODE_REMISE_BAIL[valeur]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={enCours}
        className="rounded bg-slate-900 px-3 py-1 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {enCours ? "Enregistrement…" : "Enregistrer"}
      </button>
      <button type="button" onClick={onAnnuler} className="text-sm text-slate-500 hover:text-slate-700">
        Annuler
      </button>
      {erreur && (
        <p role="alert" className="w-full text-red-600">
          {erreur}
        </p>
      )}
    </form>
  );
}

// Champ « Date d'effet du congé » d'un colocataire au bail (art. 8-1, VI),
// enregistré à la demande ; « Effacer » le vide.
export function ChampDateEffetConge({
  dateEffetConge,
  onEnregistrer
}: {
  dateEffetConge: string | null;
  onEnregistrer: (valeur: string | null) => Promise<void>;
}): React.JSX.Element {
  const [valeur, setValeur] = useState(dateEffetConge ?? "");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const modifie = valeur !== (dateEffetConge ?? "");

  async function enregistrer(nouvelle: string | null): Promise<void> {
    setErreur(null);
    setEnCours(true);
    try {
      await onEnregistrer(nouvelle);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Impossible d'enregistrer la date d'effet du congé");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <label className="flex items-center gap-1">
        Date d'effet du congé
        <input
          type="date"
          value={valeur}
          onChange={(event) => setValeur(event.target.value)}
          className="rounded border border-slate-300 px-1 py-0.5 text-xs"
        />
      </label>
      {modifie && valeur !== "" && (
        <button
          type="button"
          disabled={enCours}
          onClick={() => {
            void enregistrer(valeur);
          }}
          className="text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
        >
          Enregistrer
        </button>
      )}
      {dateEffetConge !== null && (
        <button
          type="button"
          disabled={enCours}
          onClick={() => {
            setValeur("");
            void enregistrer(null);
          }}
          className="text-slate-500 hover:text-red-600 disabled:opacity-50"
        >
          Effacer
        </button>
      )}
      {erreur && (
        <span role="alert" className="text-red-600">
          {erreur}
        </span>
      )}
    </span>
  );
}

// Confirmation du retrait d'un colocataire : la date d'effet de son congé,
// facultative, part avec le retrait (fin d'engagement de sa caution, art.
// 8-1, VI). Une date future est acceptée : le colocataire peut quitter le
// logement avant la fin de son préavis.
export function ConfirmationRetraitColocataire({
  nom,
  dateEffetConge,
  onConfirmer,
  onAnnuler
}: {
  nom: string;
  dateEffetConge: string | null;
  onConfirmer: (dateEffetConge: string | undefined) => Promise<void>;
  onAnnuler: () => void;
}): React.JSX.Element {
  const [date, setDate] = useState(dateEffetConge ?? "");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function confirmer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await onConfirmer(date === "" ? undefined : date);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Impossible de retirer le locataire du bail");
      setEnCours(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void confirmer(event);
      }}
      aria-label={`Retirer ${nom} du bail`}
      className="mt-1 flex flex-wrap items-end gap-3 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs"
    >
      <p className="w-full text-slate-700">Retirer {nom} du bail ?</p>
      <label className="flex flex-col text-slate-600">
        Date d'effet du congé (facultatif)
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="mt-0.5 rounded border border-slate-300 px-1 py-0.5 text-xs"
        />
      </label>
      <button
        type="submit"
        disabled={enCours}
        className="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700 disabled:opacity-50"
      >
        {enCours ? "Retrait…" : "Confirmer le retrait"}
      </button>
      <button type="button" onClick={onAnnuler} className="text-slate-500 hover:text-slate-700">
        Annuler
      </button>
      {erreur && (
        <p role="alert" className="w-full text-red-600">
          {erreur}
        </p>
      )}
    </form>
  );
}
