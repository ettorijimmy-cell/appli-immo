import { dateFinPreavisProposee, dureePreavisProposee, estDateIsoValide, formaterDateCourteFr } from "core";
import { useEffect, useState, type FormEvent } from "react";
import { ConfirmationActionModal } from "../components/ConfirmationActionModal";
import { aujourdHuiParis } from "../lib/date-paris";
import {
  avertissementPreavisEcoule,
  libelleDureePreavis,
  LIBELLES_AUTEUR_PREAVIS,
  LIBELLES_MODE_REMISE_PREAVIS,
  LIBELLES_MOTIF_PREAVIS_REDUIT,
  texteAnnulationPreavis,
  texteCorrectionPreavis,
  texteDateFinProposee,
  texteDeclarationPreavis,
  texteRappelLoyerPreavis,
  texteResultatPreavis
} from "../lib/textes-preavis";
import {
  annulerPreavis,
  corrigerPreavis,
  declarerPreavis,
  type AuteurPreavis,
  type Bail,
  type DeclarationPreavisInput,
  type ModeRemisePreavis,
  type MotifPreavisReduit,
  type Preavis,
  type PreavisDuBail,
  type ResultatActionPreavis
} from "../locataires/api";

type ActionEnAttente =
  | { type: "declaration"; input: DeclarationPreavisInput }
  | { type: "correction"; input: DeclarationPreavisInput }
  | { type: "annulation" };

// Préavis d'un bail (résiliation, conception 2 « vrai préavis ») : bouton
// « Préavis reçu » sur un bail actif ; carte « Préavis » (corriger, annuler,
// historique) sur un bail en préavis. Chaque action passe par une
// confirmation (ConfirmationActionModal), qui affiche aussi les refus de
// l'API (409, dont « déjà remboursé »).
export function PreavisSection({
  bail,
  numeroAppartement,
  preavis,
  onChanged
}: {
  bail: Bail;
  numeroAppartement: string;
  // null tant que non chargé.
  preavis: PreavisDuBail | null;
  onChanged: () => void;
}): React.JSX.Element | null {
  const [formulaire, setFormulaire] = useState<"aucun" | "declaration" | "correction">("aucun");
  const [enAttente, setEnAttente] = useState<ActionEnAttente | null>(null);
  const [resultat, setResultat] = useState<string | null>(null);

  if (bail.statut !== "actif" && bail.statut !== "preavis") {
    return null;
  }
  const actif = preavis?.actif ?? null;
  const historique = preavis?.historique ?? [];

  async function executer(action: ActionEnAttente): Promise<ResultatActionPreavis> {
    const reponse =
      action.type === "declaration"
        ? await declarerPreavis(bail.id, action.input)
        : action.type === "correction"
          ? await corrigerPreavis(bail.id, action.input)
          : await annulerPreavis(bail.id);
    setResultat(texteResultatPreavis(reponse.realignement));
    return reponse;
  }

  const texteConfirmation = (() => {
    if (!enAttente) {
      return null;
    }
    if (enAttente.type === "declaration") {
      return texteDeclarationPreavis({ numeroAppartement, auteur: enAttente.input.auteur, dateFin: enAttente.input.dateFin });
    }
    if (enAttente.type === "correction" && actif) {
      return texteCorrectionPreavis({ numeroAppartement, ancienneFin: actif.dateFin, nouvelleFin: enAttente.input.dateFin });
    }
    if (enAttente.type === "annulation" && actif) {
      return texteAnnulationPreavis({
        numeroAppartement,
        dateFinPreavis: actif.dateFin,
        dateFinBailAvant: actif.dateFinBailAvant
      });
    }
    return null;
  })();

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-700">Préavis</h3>

      {resultat && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {resultat}
        </p>
      )}

      {bail.statut === "actif" &&
        (formulaire === "declaration" ? (
          <FormulairePreavis
            typeBail={bail.typeBail}
            initial={null}
            libelleValider="Continuer"
            onValider={(input) => setEnAttente({ type: "declaration", input })}
            onAbandon={() => setFormulaire("aucun")}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setResultat(null);
              setFormulaire("declaration");
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Préavis reçu
          </button>
        ))}

      {bail.statut === "preavis" && actif && (
        <>
          <CartePreavis preavis={actif} />
          {(() => {
            const avertissement = avertissementPreavisEcoule(actif.dateFin, aujourdHuiParis());
            return avertissement ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{avertissement}</p>
            ) : null;
          })()}
          {formulaire === "correction" ? (
            <FormulairePreavis
              typeBail={bail.typeBail}
              initial={actif}
              libelleValider="Continuer"
              onValider={(input) => setEnAttente({ type: "correction", input })}
              onAbandon={() => setFormulaire("aucun")}
            />
          ) : (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setResultat(null);
                  setFormulaire("correction");
                }}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Corriger
              </button>
              <button
                type="button"
                onClick={() => {
                  setResultat(null);
                  setEnAttente({ type: "annulation" });
                }}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Annuler le préavis
              </button>
            </div>
          )}
        </>
      )}

      {bail.statut === "preavis" && !actif && preavis !== null && (
        <p role="alert" className="text-sm text-red-600">
          Bail en préavis, mais aucun préavis en cours n'a été trouvé : à vérifier avant toute action.
        </p>
      )}

      {historique.length > 0 && (
        <details className="text-sm text-slate-600">
          <summary className="cursor-pointer">Historique du préavis ({historique.length})</summary>
          <ul className="mt-2 space-y-1">
            {historique.map((ligne) => (
              <li key={ligne.id}>
                {LIBELLES_AUTEUR_PREAVIS[ligne.auteur]}, reçu le {formaterDateCourteFr(ligne.dateReception)}, fin au{" "}
                {formaterDateCourteFr(ligne.dateFin)} — {libelleMotifFin(ligne.motifFin)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {enAttente && texteConfirmation && (
        <ConfirmationActionModal
          {...texteConfirmation}
          action={() => executer(enAttente)}
          onTermine={() => {
            setEnAttente(null);
            setFormulaire("aucun");
            onChanged();
          }}
          onAnnuler={() => setEnAttente(null)}
        />
      )}
    </div>
  );
}

function libelleMotifFin(motif: Preavis["motifFin"]): string {
  switch (motif) {
    case "corrige":
      return "corrigé";
    case "annule":
      return "annulé";
    case "resilie":
      return "clos par la résiliation";
    default:
      return "en cours";
  }
}

function CartePreavis({ preavis }: { preavis: Preavis }): React.JSX.Element {
  return (
    <dl className="grid grid-cols-2 gap-x-8 text-sm">
      <div className="flex justify-between border-b border-slate-100 py-1">
        <dt className="text-slate-500">Auteur</dt>
        <dd>{LIBELLES_AUTEUR_PREAVIS[preavis.auteur]}</dd>
      </div>
      <div className="flex justify-between border-b border-slate-100 py-1">
        <dt className="text-slate-500">Reçu le</dt>
        <dd>{formaterDateCourteFr(preavis.dateReception)}</dd>
      </div>
      <div className="flex justify-between border-b border-slate-100 py-1">
        <dt className="text-slate-500">Mode de remise</dt>
        <dd>{preavis.modeRemise ? LIBELLES_MODE_REMISE_PREAVIS[preavis.modeRemise] : "—"}</dd>
      </div>
      <div className="flex justify-between border-b border-slate-100 py-1">
        <dt className="text-slate-500">Durée</dt>
        <dd>{libelleDureePreavis(preavis.dureeMois)}</dd>
      </div>
      <div className="flex justify-between border-b border-slate-100 py-1">
        <dt className="text-slate-500">Motif de préavis réduit</dt>
        <dd>{preavis.motifReduit ? LIBELLES_MOTIF_PREAVIS_REDUIT[preavis.motifReduit] : "—"}</dd>
      </div>
      <div className="flex justify-between border-b border-slate-100 py-1">
        <dt className="text-slate-500">Fin du préavis</dt>
        <dd>
          {formaterDateCourteFr(preavis.dateFin)}
          {preavis.dateFin !== preavis.dateFinProposee && (
            <span className="text-slate-500"> (proposée : {formaterDateCourteFr(preavis.dateFinProposee)})</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

// Formulaire de déclaration ou de correction (déclaration complète). La
// durée et la date de fin sont PROPOSÉES par Briky (packages/core,
// dureePreavisProposee et dateFinPreavisProposee), toujours modifiables ; la
// date de fin doit être confirmée explicitement (décision 1).
export function FormulairePreavis({
  typeBail,
  initial,
  libelleValider,
  onValider,
  onAbandon
}: {
  typeBail: Bail["typeBail"];
  initial: Preavis | null;
  libelleValider: string;
  onValider: (input: DeclarationPreavisInput) => void;
  onAbandon: () => void;
}): React.JSX.Element {
  const [auteur, setAuteur] = useState<AuteurPreavis>(initial?.auteur ?? "locataire");
  const [dateReception, setDateReception] = useState(initial?.dateReception ?? "");
  const [modeRemise, setModeRemise] = useState<ModeRemisePreavis | "">(initial?.modeRemise ?? "");
  const [motifReduit, setMotifReduit] = useState<MotifPreavisReduit | "">(initial?.motifReduit ?? "");
  const [dureeMois, setDureeMois] = useState(initial?.dureeMois ?? dureePreavisProposee(typeBail, "locataire"));
  const [dateFin, setDateFin] = useState(initial?.dateFin ?? "");
  const [dateFinConfirmee, setDateFinConfirmee] = useState(false);

  // Motif seulement pour un congé du locataire sur un bail vide.
  const motifPossible = typeBail === "vide" && auteur === "locataire";
  const motif = motifPossible && motifReduit !== "" ? motifReduit : null;
  const dureeValide = Number.isInteger(dureeMois) && dureeMois >= 1 && dureeMois <= 6;
  const dateProposee = estDateIsoValide(dateReception) && dureeValide ? dateFinPreavisProposee(dateReception, dureeMois) : null;

  // Une nouvelle proposition (réception ou durée changée) remplace la date
  // de fin et redemande la confirmation.
  useEffect(() => {
    if (dateProposee !== null && (initial === null || dateProposee !== initial.dateFinProposee)) {
      setDateFin(dateProposee);
      setDateFinConfirmee(false);
    }
    // Seule la proposition déclenche ce recalage (initial ne change pas
    // pendant la vie du formulaire).
  }, [dateProposee]);

  function changerAuteurOuMotif(nouvelAuteur: AuteurPreavis, nouveauMotif: MotifPreavisReduit | ""): void {
    setAuteur(nouvelAuteur);
    setMotifReduit(nouveauMotif);
    const motifRetenu = typeBail === "vide" && nouvelAuteur === "locataire" && nouveauMotif !== "" ? nouveauMotif : null;
    setDureeMois(dureePreavisProposee(typeBail, nouvelAuteur, motifRetenu));
  }

  const peutValider = estDateIsoValide(dateReception) && dureeValide && estDateIsoValide(dateFin) && dateFinConfirmee;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!peutValider) {
      return;
    }
    onValider({
      auteur,
      dateReception,
      modeRemise: modeRemise === "" ? null : modeRemise,
      dureeMois,
      motifReduit: motif,
      dateFin
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <fieldset className="space-y-1">
        <legend className="font-medium text-slate-700">Qui donne congé ?</legend>
        {(["locataire", "bailleur"] as const).map((valeur) => (
          <label key={valeur} className="mr-4 inline-flex items-center gap-1">
            <input
              type="radio"
              name="preavis-auteur"
              value={valeur}
              checked={auteur === valeur}
              onChange={() => changerAuteurOuMotif(valeur, valeur === "locataire" ? motifReduit : "")}
            />
            {LIBELLES_AUTEUR_PREAVIS[valeur]}
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="block font-medium text-slate-700">Date de réception du congé</span>
          <input
            type="date"
            required
            value={dateReception}
            onChange={(event) => setDateReception(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="space-y-1">
          <span className="block font-medium text-slate-700">Mode de remise (facultatif)</span>
          <select
            value={modeRemise}
            onChange={(event) => setModeRemise(event.target.value as ModeRemisePreavis | "")}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Non précisé</option>
            {(Object.keys(LIBELLES_MODE_REMISE_PREAVIS) as ModeRemisePreavis[]).map((valeur) => (
              <option key={valeur} value={valeur}>
                {LIBELLES_MODE_REMISE_PREAVIS[valeur]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {motifPossible && (
        <label className="block space-y-1">
          <span className="block font-medium text-slate-700">Motif de préavis réduit à un mois (si le locataire le précise et le justifie)</span>
          <select
            value={motifReduit}
            onChange={(event) => changerAuteurOuMotif(auteur, event.target.value as MotifPreavisReduit | "")}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Aucun (préavis de 3 mois)</option>
            {(Object.keys(LIBELLES_MOTIF_PREAVIS_REDUIT) as MotifPreavisReduit[]).map((valeur) => (
              <option key={valeur} value={valeur}>
                {LIBELLES_MOTIF_PREAVIS_REDUIT[valeur]}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block space-y-1">
        <span className="block font-medium text-slate-700">Durée du préavis (mois, proposée, modifiable)</span>
        <input
          type="number"
          min={1}
          max={6}
          required
          value={dureeMois}
          onChange={(event) => setDureeMois(Number(event.target.value))}
          className="w-32 rounded-md border border-slate-300 px-3 py-2"
        />
      </label>

      {dateProposee && <p className="text-slate-600">{texteDateFinProposee(dateProposee)}</p>}

      <label className="block space-y-1">
        <span className="block font-medium text-slate-700">Date de fin du préavis</span>
        <input
          type="date"
          required
          value={dateFin}
          onChange={(event) => {
            setDateFin(event.target.value);
            setDateFinConfirmee(false);
          }}
          className="w-48 rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="inline-flex items-center gap-2">
        <input type="checkbox" checked={dateFinConfirmee} onChange={(event) => setDateFinConfirmee(event.target.checked)} />
        Je confirme cette date de fin du préavis
      </label>

      <p className="text-slate-500">{texteRappelLoyerPreavis(auteur, typeBail)}</p>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!peutValider}
          className="rounded-md bg-slate-700 px-3 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {libelleValider}
        </button>
        <button type="button" onClick={onAbandon} className="text-slate-500 hover:text-slate-700">
          Abandonner
        </button>
      </div>
    </form>
  );
}
