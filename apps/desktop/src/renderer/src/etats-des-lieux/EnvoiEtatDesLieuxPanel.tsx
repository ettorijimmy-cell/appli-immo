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
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/authenticated-fetch";
import {
  envoyerEtatDesLieux,
  getDestinatairesEnvoi,
  type DestinataireEnvoi,
  type PhaseEtatDesLieux,
  type ResultatEnvoi
} from "./api";
import { messageErreurApi } from "../lib/message-erreur-api";

type Vue = "chargement" | "liste" | "confirmation" | "envoi" | "reprise" | "resultats";

interface Demande {
  demandeId: string;
  destinataires: DestinataireDemande[];
}

const BOUTON_PRINCIPAL =
  "rounded bg-indigo-700 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-800 disabled:opacity-50";
const BOUTON_SECONDAIRE =
  "rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50";

// Envoi ou renvoi depuis le desktop : mêmes règles que le mobile (packages/core)
// et même confirmation sur la liste des destinataires. Une adresse absente se
// corrige dans la fiche du locataire.
export function EnvoiEtatDesLieuxPanel({
  etatDesLieuxId,
  phase,
  scanEntreeJoint = false,
  onFermer,
  onEnvoiTermine
}: {
  etatDesLieuxId: string;
  phase: PhaseEtatDesLieux;
  // Sortie après une entrée papier : le backend joint le scan d'entrée.
  scanEntreeJoint?: boolean;
  onFermer: () => void;
  onEnvoiTermine: () => void;
}): React.JSX.Element {
  const [vue, setVue] = useState<Vue>("chargement");
  const [destinataires, setDestinataires] = useState<DestinataireEnvoi[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultats, setResultats] = useState<LigneResultatRemise<ResultatEnvoi>[]>([]);
  const demandeRef = useRef<Demande | null>(null);
  const envoiEnCours = useRef(false);

  useEffect(() => {
    let annule = false;
    getDestinatairesEnvoi(etatDesLieuxId, phase)
      .then((donnees) => {
        if (annule) {
          return;
        }
        setDestinataires(donnees.destinataires);
        setSelection(selectionInitialeRemise(donnees.destinataires));
        setVue("liste");
      })
      .catch((err: unknown) => {
        if (!annule) {
          setErreur(messageErreurApi(err, "Impossible de charger les destinataires."));
          setVue("liste");
        }
      });
    return () => {
      annule = true;
    };
  }, [etatDesLieuxId, phase]);

  const choisis: DestinataireDemande[] = destinataires.flatMap((d) =>
    selection.includes(d.locataireId) && d.email && adresseEmailPlausible(d.email)
      ? [{ locataireId: d.locataireId, nomAffiche: d.nomAffiche, email: d.email }]
      : []
  );

  function basculer(locataireId: string): void {
    setSelection((actuelle) =>
      actuelle.includes(locataireId) ? actuelle.filter((id) => id !== locataireId) : [...actuelle, locataireId]
    );
  }

  async function executer(demande: Demande): Promise<void> {
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
      onEnvoiTermine();
    } catch (err) {
      if (demandeARejouer(err instanceof ApiError ? err.status : undefined)) {
        setErreur("Aucune réponse du serveur : le mail a pu partir. Réessayez, il ne sera pas envoyé deux fois.");
        setVue("reprise");
      } else {
        demandeRef.current = null;
        setErreur(messageErreurApi(err, "L'envoi a été refusé."));
        setVue("liste");
      }
    } finally {
      envoiEnCours.current = false;
    }
  }

  function preparerRenvoi(): void {
    setSelection(destinatairesARenvoyer(resultats));
    setErreur(null);
    setVue("confirmation");
  }

  return (
    <div className="mt-2 space-y-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
      {erreur && (
        <p role="alert" className="text-xs text-red-600">
          {erreur}
        </p>
      )}

      {vue === "chargement" && <p className="text-xs text-slate-500">Chargement des destinataires…</p>}

      {vue === "liste" && (
        <>
          <ul className="space-y-1">
            {destinataires.map((d) => {
              const adresseValide = Boolean(d.email && adresseEmailPlausible(d.email));
              return (
                <li key={d.locataireId}>
                  <label className="flex items-start gap-2 text-slate-700">
                    <input
                      type="checkbox"
                      checked={selection.includes(d.locataireId)}
                      disabled={!adresseValide}
                      onChange={() => basculer(d.locataireId)}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">{d.nomAffiche}</span> —{" "}
                      {adresseValide ? d.email : "adresse à renseigner dans la fiche du locataire"}
                      {d.dernierEnvoi && (
                        <span className="block text-xs text-slate-500">{libelleResultatRemise(d.dernierEnvoi)}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setVue("confirmation")}
              disabled={choisis.length === 0}
              className={BOUTON_PRINCIPAL}
            >
              Envoyer
            </button>
            <button type="button" onClick={onFermer} className={BOUTON_SECONDAIRE}>
              Fermer
            </button>
          </div>
        </>
      )}

      {vue === "confirmation" && (
        <>
          <p className="font-medium text-slate-700">Envoyer le PDF à :</p>
          {scanEntreeJoint && (
            <p className="text-xs text-slate-600">
              Le scan de l'état des lieux d'entrée signé sur papier est joint au même mail.
            </p>
          )}
          <ul className="space-y-1">
            {choisis.map((d) => {
              const dernier = destinataires.find((x) => x.locataireId === d.locataireId)?.dernierEnvoi;
              return (
                <li key={d.locataireId} className="text-slate-700">
                  <span className="font-medium">{d.nomAffiche}</span> — {d.email}
                  {dernier?.statut === "envoye" && dernier.envoyeLe && (
                    <span className="block text-xs text-amber-800">
                      Déjà envoyé le {formaterDateHeureRemise(dernier.envoyeLe)}.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {libellesNonDestinataires(
            destinataires,
            choisis.map((d) => d.locataireId)
          ).map((libelle) => (
            <p key={libelle} className="text-xs text-amber-800">
              {libelle}
            </p>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={choisis.length === 0}
              onClick={() =>
                void executer({
                  demandeId: construireDemandeId(crypto.getRandomValues(new Uint8Array(16))),
                  destinataires: choisis
                })
              }
              className={BOUTON_PRINCIPAL}
            >
              Confirmer l'envoi
            </button>
            <button type="button" onClick={() => setVue("liste")} className={BOUTON_SECONDAIRE}>
              Annuler
            </button>
          </div>
        </>
      )}

      {vue === "envoi" && <p className="text-xs text-slate-500">Envoi en cours…</p>}

      {vue === "reprise" && (
        <button
          type="button"
          onClick={() => {
            if (demandeRef.current) {
              void executer(demandeRef.current);
            }
          }}
          className={BOUTON_PRINCIPAL}
        >
          Réessayer
        </button>
      )}

      {vue === "resultats" && (
        <>
          <ul className="space-y-1">
            {resultats.map(({ destinataire, resultat }) => (
              <li key={destinataire.locataireId} className="text-slate-700">
                <span className="font-medium">{destinataire.nomAffiche}</span> — {destinataire.email}
                <span className="block text-xs text-slate-500">{libelleResultatRemise(resultat)}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            {destinatairesARenvoyer(resultats).length > 0 && (
              <button type="button" onClick={preparerRenvoi} className={BOUTON_PRINCIPAL}>
                Renvoyer aux destinataires restants
              </button>
            )}
            <button type="button" onClick={onFermer} className={BOUTON_SECONDAIRE}>
              Fermer
            </button>
          </div>
        </>
      )}
    </div>
  );
}
