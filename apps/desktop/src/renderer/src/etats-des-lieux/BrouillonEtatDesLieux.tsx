import { formaterDateCourteFr, LONGUEUR_MAX_MOTIF_ABANDON, motifAbandonValide } from "core";
import { useEffect, useState } from "react";
import { ArchiveBadge } from "../components/ArchiveFilter";
import { ApiError } from "../lib/authenticated-fetch";
import type { Bail } from "../locataires/api";
import type { Appartement } from "../patrimoine/api";
import { abandonnerEtatDesLieux, listerEtatsDesLieuxAbandonnes, type EtatDesLieuxAbandonne } from "./api";

function Modale({ titre, children }: { titre: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-label={titre} className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-base font-semibold">{titre}</h2>
        {children}
      </div>
    </div>
  );
}

// Confirmation avant création (décision du 2026-11-05) : un état des lieux
// n'est plus jamais créé d'un seul clic, sans savoir pour quel logement.
export function ConfirmationCreationModal({
  bail,
  appartement,
  enCours,
  erreur,
  onAnnuler,
  onConfirmer
}: {
  bail: Bail;
  appartement: Appartement;
  enCours: boolean;
  erreur: string | null;
  onAnnuler: () => void;
  onConfirmer: () => void;
}): React.JSX.Element {
  return (
    <Modale titre="Créer l'état des lieux ?">
      <p className="text-sm text-slate-700">
        Logement n° {appartement.numero}
        {appartement.type ? ` (${appartement.type})` : ""}, bail du {formaterDateCourteFr(bail.dateDebut)}.
      </p>
      <p className="text-sm text-slate-600">
        Un seul état des lieux couvre l'entrée et la sortie de ce bail. Tant qu'aucune phase n'est signée, il pourra
        être abandonné.
      </p>
      {erreur && (
        <p role="alert" className="text-sm text-red-600">
          {erreur}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onAnnuler}
          disabled={enCours}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={onConfirmer}
          disabled={enCours}
          className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {enCours ? "Création…" : "Créer l'état des lieux"}
        </button>
      </div>
    </Modale>
  );
}

// Abandon d'un brouillon : motif court obligatoire, rien n'est supprimé (le
// brouillon reste consultable via "Afficher les archivés").
export function AbandonBrouillonModal({
  etatDesLieuxId,
  onAnnuler,
  onAbandonne
}: {
  etatDesLieuxId: string;
  onAnnuler: () => void;
  onAbandonne: () => void;
}): React.JSX.Element {
  const [saisie, setSaisie] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const motif = motifAbandonValide(saisie);

  async function confirmer(): Promise<void> {
    if (!motif) {
      return;
    }
    setEnCours(true);
    setErreur(null);
    try {
      await abandonnerEtatDesLieux(etatDesLieuxId, motif);
      onAbandonne();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : "Impossible d'abandonner ce brouillon.");
      setEnCours(false);
    }
  }

  return (
    <Modale titre="Abandonner le brouillon ?">
      <p className="text-sm text-slate-600">
        Le brouillon et ce qui y a été saisi sont conservés, mais ne pourront plus être modifiés. Le bail pourra
        recevoir un nouvel état des lieux.
      </p>
      <label className="block text-sm font-medium text-slate-700">
        Motif
        <textarea
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          maxLength={LONGUEUR_MAX_MOTIF_ABANDON}
          rows={2}
          placeholder="Ex. : créé par erreur"
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm font-normal text-slate-900"
        />
      </label>
      <p className="text-xs text-slate-500">
        {saisie.length}/{LONGUEUR_MAX_MOTIF_ABANDON} caractères
      </p>
      {erreur && (
        <p role="alert" className="text-sm text-red-600">
          {erreur}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onAnnuler}
          disabled={enCours}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void confirmer()}
          disabled={enCours || !motif}
          className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
        >
          {enCours ? "Abandon…" : "Abandonner le brouillon"}
        </button>
      </div>
    </Modale>
  );
}

// Brouillons abandonnés du bail, visibles avec "Afficher les archivés".
export function BrouillonsAbandonnesCard({ bailId }: { bailId: string }): React.JSX.Element | null {
  const [lignes, setLignes] = useState<EtatDesLieuxAbandonne[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    listerEtatsDesLieuxAbandonnes(bailId)
      .then((resultat) => {
        if (!annule) setLignes(resultat);
      })
      .catch(() => {
        if (!annule) setErreur("Impossible de charger les brouillons abandonnés.");
      });
    return () => {
      annule = true;
    };
  }, [bailId]);

  if (erreur) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {erreur}
      </p>
    );
  }
  if (!lignes || lignes.length === 0) {
    return null;
  }
  return (
    <div className="rounded-lg border border-slate-200 p-4 opacity-80">
      <h3 className="text-sm font-semibold text-slate-700">Brouillons abandonnés</h3>
      <ul className="mt-2 space-y-1">
        {lignes.map((ligne) => (
          <li key={ligne.id} className="text-sm text-slate-600">
            Créé le {new Date(ligne.createdAt).toLocaleDateString("fr-FR")}, abandonné le{" "}
            {new Date(ligne.archivedAt).toLocaleDateString("fr-FR")} : {ligne.motifAbandon}
            <ArchiveBadge />
          </li>
        ))}
      </ul>
    </div>
  );
}
