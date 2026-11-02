import {
  LONGUEUR_MAX_NOUVELLE_ADRESSE,
  LONGUEUR_MAX_OBSERVATIONS_GENERALES,
  nettoyerTexteObservation,
  resoudreNouvelleAdresseSortie
} from "core";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  getSignatairesAttendus,
  type SignataireAttendu,
  type SignerEtatDesLieuxInput
} from "../api/etats-des-lieux";
import { ApiError } from "../lib/authenticated-fetch";
import type { EtapeHandle } from "./etape-handle";
import { ZoneSignature, type ZoneSignatureHandle } from "./ZoneSignature";

interface CarteSignataire {
  role: "bailleur" | "locataire";
  locataireId?: string;
  nom: string;
  nomModifiable: boolean;
  luEtApprouve: boolean;
  dataUrlPng: string | null;
}

// Conservées par EtatDesLieuxStepper : « Précédent » démonte cet écran, et
// revenir vérifier une pièce ne doit pas faire perdre un texte long.
export interface BrouillonObservations {
  observationsBailleur: string;
  reservesLocataire: string;
}

// `toDataURL("image/png")` renvoie "data:image/png;base64,XXXX" —
// decoderEtValiderImageSignature (backend) attend le base64 brut (même
// contrat que @IsBase64() sur SignerEtatDesLieuxDto, qui rejetterait le
// préfixe "data:...;base64," — ':'/';' ne sont pas des caractères base64
// valides).
function extraireBase64(dataUrlPng: string): string {
  const virgule = dataUrlPng.indexOf(",");
  return virgule === -1 ? dataUrlPng : dataUrlPng.slice(virgule + 1);
}

function carteDepuisSignataire(signataire: SignataireAttendu): CarteSignataire {
  return {
    role: "locataire",
    locataireId: signataire.locataireId,
    nom: signataire.nomAffiche,
    nomModifiable: false,
    luEtApprouve: false,
    dataUrlPng: null
  };
}

// Dernière étape du parcours (après le récapitulatif) : une carte par
// signataire attendu (bailleur, puis chaque locataire actif du bail),
// « Lu et approuvé » + tracé tactile avant de pouvoir appuyer sur
// « Terminer » (EtatDesLieuxStepper désactive le bouton via
// onPretChange tant que toutes les cartes ne sont pas complètes — jamais
// une simple désactivation locale invisible du reste du parcours).
// Un seul appel réseau à la soumission (signer-entree/signer-sortie, posé
// par l'appelant via `onSubmit`) : jamais un submit par carte. En cas
// d'échec réseau, les cartes restent intactes en mémoire (aucun état
// local réinitialisé ici) — la resoumission via "Réessayer" renvoie donc
// exactement les mêmes données, même principe de résilience que les
// autres étapes du parcours.
export const SignatureStepScreen = forwardRef<
  EtapeHandle,
  {
    etatDesLieuxId: string;
    mode: "entree" | "sortie";
    brouillonObservations?: BrouillonObservations;
    onBrouillonObservationsChange?: (brouillon: BrouillonObservations) => void;
    onPretChange: (pret: boolean) => void;
    onSubmit: (input: SignerEtatDesLieuxInput) => Promise<void>;
  }
>(function SignatureStepScreen(
  { etatDesLieuxId, mode, brouillonObservations, onBrouillonObservationsChange, onPretChange, onSubmit },
  ref
) {
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [lieu, setLieu] = useState("");
  const [nouvelleAdresse, setNouvelleAdresse] = useState("");
  const [observations, setObservations] = useState<BrouillonObservations>(
    brouillonObservations ?? { observationsBailleur: "", reservesLocataire: "" }
  );
  const [cartes, setCartes] = useState<CarteSignataire[]>([]);
  const [confirmationModification, setConfirmationModification] = useState(false);
  const zonesRef = useRef<Record<number, ZoneSignatureHandle | null>>({});

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreurChargement(null);
    getSignatairesAttendus(etatDesLieuxId)
      .then((donnees) => {
        if (annule) {
          return;
        }
        setLieu(donnees.villeLogement);
        setNouvelleAdresse(donnees.nouvelleAdresseLocataire ?? "");
        setCartes([
          {
            role: "bailleur",
            nom: donnees.bailleurNomPropose,
            nomModifiable: true,
            luEtApprouve: false,
            dataUrlPng: null
          },
          ...donnees.locataires.map(carteDepuisSignataire)
        ]);
      })
      .catch((err: unknown) => {
        if (!annule) {
          setErreurChargement(
            err instanceof ApiError ? err.message : "Impossible de charger les signataires attendus"
          );
        }
      })
      .finally(() => {
        if (!annule) {
          setChargement(false);
        }
      });
    return () => {
      annule = true;
    };
  }, [etatDesLieuxId]);

  // Une signature couvre exactement le texte affiché : dès qu'un signataire a
  // coché sa case ou tracé, plus aucune saisie imprimée dans le document ne
  // change (lieu, nouvelle adresse, observations, réserves, nom du bailleur).
  // Les modifier passe par modifierLesTextes, qui efface toutes les signatures.
  // Tout nouveau champ de cet écran suit la même règle : le test « aucun champ
  // de saisie ne reste modifiable » (signature.spec.ts) échoue sinon.
  const textesVerrouilles = cartes.some((c) => c.luEtApprouve || c.dataUrlPng !== null);
  const classeTexte = `w-full rounded-md border px-3 py-2 text-base ${
    textesVerrouilles ? "border-slate-200 bg-slate-100 text-slate-500" : "border-slate-300"
  }`;

  const adresseSortie = resoudreNouvelleAdresseSortie(nouvelleAdresse, null);
  const estComplet =
    cartes.length > 0 &&
    cartes.every((c) => c.luEtApprouve && c.dataUrlPng !== null && c.nom.trim() !== "") &&
    (mode === "entree" || adresseSortie !== null);

  useEffect(() => {
    onPretChange(estComplet);
  }, [estComplet, onPretChange]);

  useEffect(() => {
    if (!textesVerrouilles) {
      setConfirmationModification(false);
    }
  }, [textesVerrouilles]);

  // Jamais prêt tant que le chargement des signataires n'a pas réussi —
  // sans quoi le bouton "Terminer" resterait activé depuis l'étape
  // précédente (valeur par défaut côté EtatDesLieuxStepper) pendant que
  // cette étape est encore vide.
  useEffect(() => {
    if (chargement || erreurChargement) {
      onPretChange(false);
    }
  }, [chargement, erreurChargement, onPretChange]);

  useImperativeHandle(ref, () => ({
    submit: async () => {
      const bailleur = cartes.find((c) => c.role === "bailleur");
      if (!bailleur?.dataUrlPng) {
        throw new Error("Signature du bailleur manquante.");
      }
      const observationsBailleur = nettoyerTexteObservation(observations.observationsBailleur);
      const reservesLocataire = nettoyerTexteObservation(observations.reservesLocataire);
      const input: SignerEtatDesLieuxInput = {
        bailleur: {
          nomAffiche: bailleur.nom.trim(),
          luEtApprouve: bailleur.luEtApprouve,
          imagePng: extraireBase64(bailleur.dataUrlPng)
        },
        locataires: cartes
          .filter((c) => c.role === "locataire")
          .map((c) => ({
            locataireId: c.locataireId!,
            luEtApprouve: c.luEtApprouve,
            imagePng: extraireBase64(c.dataUrlPng!)
          })),
        lieu: lieu.trim(),
        ...(mode === "sortie" && adresseSortie !== null && { nouvelleAdresseLocataire: adresseSortie }),
        ...(observationsBailleur !== null &&
          (mode === "entree"
            ? { observationsBailleurEntree: observationsBailleur }
            : { observationsBailleurSortie: observationsBailleur })),
        ...(reservesLocataire !== null &&
          (mode === "entree"
            ? { reservesLocataireEntree: reservesLocataire }
            : { reservesLocataireSortie: reservesLocataire }))
      };
      await onSubmit(input);
    }
  }));

  function majObservations(patch: Partial<BrouillonObservations>): void {
    const suivantes = { ...observations, ...patch };
    setObservations(suivantes);
    onBrouillonObservationsChange?.(suivantes);
  }

  function modifierLesTextes(): void {
    for (const zone of Object.values(zonesRef.current)) {
      zone?.clear();
    }
    setCartes((v) => v.map((c) => ({ ...c, luEtApprouve: false, dataUrlPng: null })));
  }

  function majCarte(index: number, patch: Partial<CarteSignataire>): void {
    setCartes((v) => v.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  if (chargement) {
    return <p className="text-sm text-slate-500">Chargement des signataires…</p>;
  }
  if (erreurChargement) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {erreurChargement}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-lg font-semibold text-slate-800">
        Signature de {mode === "entree" ? "l'entrée" : "la sortie"}
      </p>

      <div className="space-y-2 rounded-md bg-slate-50 p-3">
        <p className="text-sm text-slate-700">
          Fait le {new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date())}, à
        </p>
        <input
          value={lieu}
          onChange={(e) => setLieu(e.target.value)}
          readOnly={textesVerrouilles}
          placeholder="Ville"
          className={classeTexte}
        />
      </div>

      {mode === "sortie" && (
        <div className="space-y-2 rounded-md bg-slate-50 p-3">
          <label htmlFor="nouvelle-adresse" className="block text-sm font-medium text-slate-700">
            Nouvelle adresse du locataire
          </label>
          <textarea
            id="nouvelle-adresse"
            value={nouvelleAdresse}
            onChange={(e) => setNouvelleAdresse(e.target.value)}
            readOnly={textesVerrouilles}
            maxLength={LONGUEUR_MAX_NOUVELLE_ADRESSE}
            rows={3}
            className={classeTexte}
          />
          <p className="text-xs text-slate-500">
            Colocataires : le nom devant chaque adresse. Si elle n'est pas connue, indiquez « Non communiquée par le
            locataire ».
          </p>
        </div>
      )}

      <div className="space-y-3 rounded-md bg-slate-50 p-3">
        <div className="space-y-2">
          <label htmlFor="observations-bailleur" className="block text-sm font-medium text-slate-700">
            Observations du bailleur (facultatif)
          </label>
          <textarea
            id="observations-bailleur"
            value={observations.observationsBailleur}
            onChange={(e) => majObservations({ observationsBailleur: e.target.value })}
            readOnly={textesVerrouilles}
            maxLength={LONGUEUR_MAX_OBSERVATIONS_GENERALES}
            rows={4}
            className={classeTexte}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="reserves-locataire" className="block text-sm font-medium text-slate-700">
            Réserves du locataire (facultatif)
          </label>
          <textarea
            id="reserves-locataire"
            value={observations.reservesLocataire}
            onChange={(e) => majObservations({ reservesLocataire: e.target.value })}
            readOnly={textesVerrouilles}
            maxLength={LONGUEUR_MAX_OBSERVATIONS_GENERALES}
            rows={4}
            className={classeTexte}
          />
        </div>
      </div>

      {textesVerrouilles && (
        <div className="space-y-2 rounded-md border border-slate-200 p-3">
          {mode === "sortie" && adresseSortie === null && (
            <p role="alert" className="text-sm text-red-700">
              Nouvelle adresse manquante : modifiez les textes pour la saisir avant de signer.
            </p>
          )}
          {confirmationModification ? (
            <>
              <p className="text-sm text-slate-700">Toutes les signatures déjà faites seront effacées et devront être refaites</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmationModification(false)}
                  className="flex-1 rounded-md border border-slate-300 py-2 text-sm font-medium text-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={modifierLesTextes}
                  className="flex-1 rounded-md bg-red-700 py-2 text-sm font-medium text-white"
                >
                  Effacer les signatures
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmationModification(true)}
              className="text-sm text-indigo-700 underline underline-offset-2"
            >
              Modifier les textes
            </button>
          )}
        </div>
      )}

      {cartes.map((carte, index) => (
        <div key={carte.locataireId ?? "bailleur"} className="space-y-3 rounded-md border border-slate-200 p-3">
          {carte.nomModifiable ? (
            <input
              value={carte.nom}
              onChange={(e) => majCarte(index, { nom: e.target.value })}
              readOnly={textesVerrouilles}
              placeholder="Nom du bailleur"
              className={`${classeTexte} font-semibold`}
            />
          ) : (
            <p className="text-base font-semibold text-slate-800">{carte.nom}</p>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={carte.luEtApprouve}
              onChange={(e) => majCarte(index, { luEtApprouve: e.target.checked })}
              className="h-5 w-5"
            />
            Lu et approuvé
          </label>

          <ZoneSignature
            actif={carte.luEtApprouve}
            onChange={(dataUrlPng) => majCarte(index, { dataUrlPng })}
            ref={(instance) => {
              zonesRef.current[index] = instance;
            }}
          />

          <button
            type="button"
            onClick={() => zonesRef.current[index]?.clear()}
            disabled={!carte.luEtApprouve}
            className="text-sm text-indigo-700 underline underline-offset-2 disabled:opacity-40"
          >
            Effacer
          </button>
        </div>
      ))}
    </div>
  );
});
