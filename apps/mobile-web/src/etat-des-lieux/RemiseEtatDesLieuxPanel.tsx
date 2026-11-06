import {
  adresseEmailPlausible,
  construireDemandeId,
  demandeARejouer,
  destinatairesARenvoyer,
  formaterDateHeureRemise,
  libelleResultatRemise,
  libellesNonDestinataires,
  lignesResultatRemise,
  selectionInitialeRemise,
  type DestinataireDemande,
  type LigneResultatRemise
} from "core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  enregistrerEmailLocataire,
  envoyerEtatDesLieux,
  getDestinatairesEnvoi,
  produirePdfEtatDesLieux,
  type DestinataireEnvoi,
  type PhaseEtatDesLieux,
  type ResultatEnvoi
} from "../api/etats-des-lieux";
import { ApiError } from "../lib/authenticated-fetch";
import { INTERVALLE_PDF_MS, PLAFOND_ATTENTE_PDF_MS } from "./remise-etat-des-lieux";

type EtatPdf = "preparation" | "pret" | "delai" | "bloque";
type Vue = "liste" | "confirmation" | "envoi" | "reprise" | "resultats";

interface Demande {
  demandeId: string;
  destinataires: DestinataireDemande[];
}

function messageErreur(err: unknown, repli: string): string {
  return err instanceof ApiError ? err.message : repli;
}

// Saisie d'une adresse manquante ou mal formée, ou modification d'une adresse
// valide sur place : la remise a lieu à la signature, sans passer par le
// desktop. Remplacer une adresse valide se confirme avant d'écrire la fiche.
function EditionAdresse({
  destinataire,
  modification,
  onEnregistree,
  onSaisieEnAttente,
  onAnnuler
}: {
  destinataire: DestinataireEnvoi;
  modification: boolean;
  onEnregistree: (email: string) => void;
  onSaisieEnAttente: (locataireId: string, enAttente: boolean) => void;
  onAnnuler?: () => void;
}): React.JSX.Element {
  const [email, setEmail] = useState(destinataire.email ?? "");
  const [aConfirmer, setAConfirmer] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Une saisie non enregistrée bloque l'envoi : sur place, on croirait à tort
  // ce destinataire servi. onSaisieEnAttente doit rester stable : une fonction
  // recréée à chaque rendu relancerait cet effet, qui met à jour le parent, en
  // boucle tant qu'une saisie est en attente.
  const { locataireId } = destinataire;
  const enAttente = email.trim() !== (destinataire.email ?? "");
  useEffect(() => {
    onSaisieEnAttente(locataireId, enAttente);
    return () => onSaisieEnAttente(locataireId, false);
  }, [locataireId, enAttente, onSaisieEnAttente]);

  function verifier(): void {
    const adresse = email.trim();
    if (!adresseEmailPlausible(adresse)) {
      setErreur("Adresse e-mail invalide.");
      return;
    }
    setErreur(null);
    if (modification && adresse === destinataire.email) {
      onAnnuler?.();
    } else if (modification) {
      setAConfirmer(true);
    } else {
      void enregistrer();
    }
  }

  async function enregistrer(): Promise<void> {
    const adresse = email.trim();
    setEnregistrement(true);
    try {
      await enregistrerEmailLocataire(destinataire.locataireId, adresse);
      onEnregistree(adresse);
    } catch (err) {
      setAConfirmer(false);
      setErreur(
        err instanceof ApiError && err.status === 400
          ? "Adresse e-mail invalide."
          : messageErreur(err, "Enregistrement impossible : vérifiez votre connexion.")
      );
    } finally {
      setEnregistrement(false);
    }
  }

  if (aConfirmer) {
    return (
      <div className="mt-2 space-y-2">
        <p className="break-all text-sm text-slate-700">
          Remplacer {destinataire.email} par {email.trim()} dans la fiche de {destinataire.nomAffiche} ?
        </p>
        <button
          type="button"
          onClick={() => void enregistrer()}
          disabled={enregistrement}
          className="w-full rounded-md bg-indigo-700 py-2 text-base font-medium text-white disabled:opacity-50"
        >
          {enregistrement ? "Enregistrement…" : "Confirmer la modification"}
        </button>
        <button
          type="button"
          onClick={() => setAConfirmer(false)}
          disabled={enregistrement}
          className="w-full rounded-md border border-slate-300 py-2 text-base font-medium text-slate-700 disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <label htmlFor={`email-${destinataire.locataireId}`} className="block text-sm text-slate-700">
        Adresse e-mail de {destinataire.nomAffiche}
      </label>
      <input
        id={`email-${destinataire.locataireId}`}
        type="email"
        inputMode="email"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-base"
      />
      <button
        type="button"
        onClick={verifier}
        disabled={enregistrement}
        className="w-full rounded-md border border-indigo-700 py-2 text-base font-medium text-indigo-700 disabled:opacity-50"
      >
        {enregistrement ? "Enregistrement…" : "Enregistrer dans la fiche"}
      </button>
      {onAnnuler && (
        <button
          type="button"
          onClick={onAnnuler}
          className="w-full rounded-md border border-slate-300 py-2 text-base font-medium text-slate-700"
        >
          Annuler
        </button>
      )}
      {erreur && (
        <p role="alert" className="text-sm text-red-600">
          {erreur}
        </p>
      )}
    </div>
  );
}

// Remise de l'état des lieux signé. Raccourci juste après la signature, et
// accessible à tout moment depuis la page pour chaque phase signée. L'envoi
// reste toujours un geste explicite, confirmé sur la liste des destinataires.
export function RemiseEtatDesLieuxPanel({
  etatDesLieuxId,
  phase,
  scanEntreeJoint = false,
  onRetour
}: {
  etatDesLieuxId: string;
  phase: PhaseEtatDesLieux;
  // Sortie après une entrée papier : le backend joint le scan d'entrée.
  scanEntreeJoint?: boolean;
  onRetour: () => void;
}): React.JSX.Element {
  const [etatPdf, setEtatPdf] = useState<EtatPdf>("preparation");
  const [tentativePdf, setTentativePdf] = useState(0);
  const [productionPdf, setProductionPdf] = useState(false);
  const [destinataires, setDestinataires] = useState<DestinataireEnvoi[]>([]);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [adresseEnEdition, setAdresseEnEdition] = useState<string | null>(null);
  const [saisiesEnAttente, setSaisiesEnAttente] = useState<string[]>([]);
  const [vue, setVue] = useState<Vue>("liste");
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultats, setResultats] = useState<LigneResultatRemise<ResultatEnvoi>[]>([]);
  const demandeRef = useRef<Demande | null>(null);
  const envoiEnCours = useRef(false);

  const libellePhase = phase === "entree" ? "d'entrée" : "de sortie";

  // Le backend relance lui-même la production du PDF à chaque lecture, sans
  // jamais lancer deux chaînes pour la même phase.
  useEffect(() => {
    let annule = false;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const debut = Date.now();

    async function interroger(): Promise<void> {
      try {
        const donnees = await getDestinatairesEnvoi(etatDesLieuxId, phase);
        if (annule) {
          return;
        }
        setDestinataires(donnees.destinataires);
        setSelection((actuelle) => actuelle ?? selectionInitialeRemise(donnees.destinataires));
        if (donnees.pdfDisponible) {
          setEtatPdf("pret");
          return;
        }
      } catch (err) {
        if (annule) {
          return;
        }
        if (err instanceof ApiError && err.status < 500) {
          setErreur(err.message);
          setEtatPdf("bloque");
          return;
        }
      }
      if (Date.now() - debut >= PLAFOND_ATTENTE_PDF_MS) {
        setEtatPdf("delai");
        return;
      }
      minuteur = setTimeout(() => void interroger(), INTERVALLE_PDF_MS);
    }

    setEtatPdf("preparation");
    void interroger();
    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [etatDesLieuxId, phase, tentativePdf]);

  const relire = useCallback(async (): Promise<void> => {
    try {
      const donnees = await getDestinatairesEnvoi(etatDesLieuxId, phase);
      setDestinataires(donnees.destinataires);
    } catch {
      // Les résultats déjà affichés restent justes : la liste se relira au
      // prochain passage sur cet écran.
    }
  }, [etatDesLieuxId, phase]);

  async function relancerPdf(): Promise<void> {
    setErreur(null);
    setProductionPdf(true);
    try {
      await produirePdfEtatDesLieux(etatDesLieuxId, phase);
    } catch (err) {
      setErreur(messageErreur(err, "Production impossible : vérifiez votre connexion."));
    } finally {
      setProductionPdf(false);
      setTentativePdf((t) => t + 1);
    }
  }

  function basculer(locataireId: string): void {
    setSelection((actuelle) =>
      (actuelle ?? []).includes(locataireId)
        ? (actuelle ?? []).filter((id) => id !== locataireId)
        : [...(actuelle ?? []), locataireId]
    );
  }

  const signalerSaisie = useCallback((locataireId: string, enAttente: boolean): void => {
    setSaisiesEnAttente((actuelles) => {
      const autres = actuelles.filter((id) => id !== locataireId);
      return enAttente ? [...autres, locataireId] : autres;
    });
  }, []);

  function adresseEnregistree(locataireId: string, email: string): void {
    setDestinataires((liste) => liste.map((d) => (d.locataireId === locataireId ? { ...d, email } : d)));
    setAdresseEnEdition(null);
    setSelection((actuelle) => [...new Set([...(actuelle ?? []), locataireId])]);
  }

  function destinatairesChoisis(): DestinataireDemande[] {
    return destinataires.flatMap((d) =>
      selection?.includes(d.locataireId) && d.email && adresseEmailPlausible(d.email)
        ? [{ locataireId: d.locataireId, nomAffiche: d.nomAffiche, email: d.email }]
        : []
    );
  }

  async function executerDemande(demande: Demande): Promise<void> {
    // Verrou synchrone : un état React n'empêcherait pas un double appui
    // dans le même rendu.
    if (envoiEnCours.current) {
      return;
    }
    envoiEnCours.current = true;
    demandeRef.current = demande;
    setErreur(null);
    setVue("envoi");
    try {
      const reponse = await envoyerEtatDesLieux(etatDesLieuxId, phase, {
        demandeId: demande.demandeId,
        destinataires: demande.destinataires.map(({ locataireId, email }) => ({ locataireId, email }))
      });
      demandeRef.current = null;
      setResultats(lignesResultatRemise(demande.destinataires, reponse.resultats));
      setVue("resultats");
      await relire();
    } catch (err) {
      if (demandeARejouer(err instanceof ApiError ? err.status : undefined)) {
        setErreur("Aucune réponse du serveur : le mail a pu partir. Réessayez, il ne sera pas envoyé deux fois.");
        setVue("reprise");
      } else {
        demandeRef.current = null;
        setErreur(messageErreur(err, "L'envoi a été refusé."));
        setVue("liste");
        await relire();
      }
    } finally {
      envoiEnCours.current = false;
    }
  }

  function reprendre(): void {
    if (demandeRef.current) {
      void executerDemande(demandeRef.current);
    }
  }

  function preparerRenvoi(): void {
    setSelection(destinatairesARenvoyer(resultats));
    setErreur(null);
    setVue("confirmation");
  }

  const choisis = destinatairesChoisis();
  const nomsSaisiesEnAttente = destinataires
    .filter((d) => saisiesEnAttente.includes(d.locataireId))
    .map((d) => d.nomAffiche);
  const nonDestinataires = libellesNonDestinataires(
    destinataires,
    choisis.map((d) => d.locataireId)
  );
  const renvoisPossibles = destinatairesARenvoyer(resultats).length > 0;

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-lg font-semibold text-slate-800">Remise de l'état des lieux {libellePhase}</h1>
      {scanEntreeJoint && (
        <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
          Le scan de l'état des lieux d'entrée, signé sur papier, est joint au même mail que le PDF de sortie.
        </p>
      )}

      {etatPdf === "preparation" && (
        <p role="status" className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
          PDF en préparation… Cela peut prendre une minute.
        </p>
      )}

      {etatPdf === "delai" && (
        <div className="space-y-3 rounded-md bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            Le PDF n'est pas encore prêt. Vous pouvez réessayer, ou l'envoyer plus tard depuis cette page ou
            l'application desktop.
          </p>
          <button
            type="button"
            onClick={() => void relancerPdf()}
            disabled={productionPdf}
            className="w-full rounded-md bg-indigo-700 py-3 text-base font-medium text-white disabled:opacity-50"
          >
            {productionPdf ? "Production…" : "Réessayer"}
          </button>
        </div>
      )}

      {erreur && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p role="alert" className="text-sm text-red-700">
            {erreur}
          </p>
        </div>
      )}

      {etatPdf === "pret" && vue === "liste" && (
        <>
          <p role="status" className="text-sm text-emerald-700">
            PDF prêt.
          </p>
          <ul className="space-y-3">
            {destinataires.map((d) => (
              <li key={d.locataireId} className="rounded-md border border-slate-200 p-3">
                {d.email && adresseEmailPlausible(d.email) && adresseEnEdition !== d.locataireId ? (
                  <>
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selection?.includes(d.locataireId) ?? false}
                        onChange={() => basculer(d.locataireId)}
                        className="mt-1 h-5 w-5"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-800">{d.nomAffiche}</span>
                        <span className="block break-all text-sm text-slate-600">{d.email}</span>
                      </span>
                    </label>
                    <button
                      type="button"
                      aria-label={`Modifier l'adresse de ${d.nomAffiche}`}
                      onClick={() => setAdresseEnEdition(d.locataireId)}
                      className="mt-2 text-sm text-indigo-700 underline underline-offset-2"
                    >
                      Modifier l'adresse
                    </button>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-slate-800">{d.nomAffiche}</p>
                    <EditionAdresse
                      destinataire={d}
                      modification={adresseEnEdition === d.locataireId}
                      onEnregistree={(email) => adresseEnregistree(d.locataireId, email)}
                      onSaisieEnAttente={signalerSaisie}
                      {...(adresseEnEdition === d.locataireId && { onAnnuler: () => setAdresseEnEdition(null) })}
                    />
                  </>
                )}
                {d.dernierEnvoi && <p className="mt-2 text-sm text-slate-500">{libelleResultatRemise(d.dernierEnvoi)}</p>}
              </li>
            ))}
          </ul>
          {nomsSaisiesEnAttente.length > 0 && (
            <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Adresse saisie mais non enregistrée pour {nomsSaisiesEnAttente.join(", ")}. Enregistrez-la dans la fiche
              ou videz le champ avant d'envoyer.
            </p>
          )}
          <button
            type="button"
            onClick={() => setVue("confirmation")}
            disabled={choisis.length === 0 || nomsSaisiesEnAttente.length > 0}
            className="w-full rounded-md bg-indigo-700 py-3 text-base font-medium text-white disabled:opacity-50"
          >
            Envoyer l'état des lieux
          </button>
        </>
      )}

      {etatPdf === "pret" && vue === "confirmation" && (
        <div className="space-y-3 rounded-md border border-slate-200 p-3">
          <p className="text-base font-medium text-slate-800">
            Envoyer l'état des lieux {libellePhase}
            {scanEntreeJoint ? " et le scan de l'entrée papier" : ""} à :
          </p>
          <ul className="space-y-2">
            {choisis.map((d) => {
              const dernier = destinataires.find((x) => x.locataireId === d.locataireId)?.dernierEnvoi;
              return (
                <li key={d.locataireId} className="text-sm text-slate-700">
                  <span className="font-medium">{d.nomAffiche}</span> — <span className="break-all">{d.email}</span>
                  {dernier?.statut === "envoye" && dernier.envoyeLe && (
                    <span className="block text-amber-800">Déjà envoyé le {formaterDateHeureRemise(dernier.envoyeLe)}.</span>
                  )}
                </li>
              );
            })}
          </ul>
          {nonDestinataires.length > 0 && (
            <ul className="space-y-1 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              {nonDestinataires.map((libelle) => (
                <li key={libelle}>{libelle}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => void executerDemande({ demandeId: construireDemandeId(crypto.getRandomValues(new Uint8Array(16))), destinataires: choisis })}
            disabled={choisis.length === 0}
            className="w-full rounded-md bg-indigo-700 py-3 text-base font-medium text-white disabled:opacity-50"
          >
            Confirmer l'envoi
          </button>
          <button
            type="button"
            onClick={() => setVue("liste")}
            className="w-full rounded-md border border-slate-300 py-3 text-base font-medium text-slate-700"
          >
            Annuler
          </button>
        </div>
      )}

      {vue === "envoi" && (
        <p role="status" className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
          Envoi en cours…
        </p>
      )}

      {vue === "reprise" && (
        <button
          type="button"
          onClick={reprendre}
          className="w-full rounded-md bg-indigo-700 py-3 text-base font-medium text-white"
        >
          Réessayer
        </button>
      )}

      {vue === "resultats" && (
        <>
          <ul className="space-y-3">
            {resultats.map(({ destinataire, resultat }) => (
              <li key={destinataire.locataireId} className="rounded-md border border-slate-200 p-3">
                <p className="font-medium text-slate-800">{destinataire.nomAffiche}</p>
                <p className="break-all text-sm text-slate-600">{destinataire.email}</p>
                <p className="mt-1 text-sm text-slate-700">{libelleResultatRemise(resultat)}</p>
              </li>
            ))}
          </ul>
          {renvoisPossibles && (
            <button
              type="button"
              onClick={preparerRenvoi}
              className="w-full rounded-md bg-indigo-700 py-3 text-base font-medium text-white"
            >
              Renvoyer aux destinataires restants
            </button>
          )}
        </>
      )}

      {vue !== "envoi" && (
        <button
          type="button"
          onClick={onRetour}
          className="w-full rounded-md border border-slate-300 py-3 text-base font-medium text-slate-700"
        >
          Retour
        </button>
      )}
    </div>
  );
}
