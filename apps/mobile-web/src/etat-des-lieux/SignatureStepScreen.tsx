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
    onPretChange: (pret: boolean) => void;
    onSubmit: (input: SignerEtatDesLieuxInput) => Promise<void>;
  }
>(function SignatureStepScreen({ etatDesLieuxId, mode, onPretChange, onSubmit }, ref) {
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [lieu, setLieu] = useState("");
  const [cartes, setCartes] = useState<CarteSignataire[]>([]);
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

  const estComplet =
    cartes.length > 0 && cartes.every((c) => c.luEtApprouve && c.dataUrlPng !== null && c.nom.trim() !== "");

  useEffect(() => {
    onPretChange(estComplet);
  }, [estComplet, onPretChange]);

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
        lieu: lieu.trim()
      };
      await onSubmit(input);
    }
  }));

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
          placeholder="Ville"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-base"
        />
      </div>

      {cartes.map((carte, index) => (
        <div key={carte.locataireId ?? "bailleur"} className="space-y-3 rounded-md border border-slate-200 p-3">
          {carte.nomModifiable ? (
            <input
              value={carte.nom}
              onChange={(e) => majCarte(index, { nom: e.target.value })}
              placeholder="Nom du bailleur"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-base font-semibold"
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
