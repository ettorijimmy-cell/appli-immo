import { formaterDateCourteFr, formaterListeNoms, type EntreePapierEtatDesLieux } from "core";
import { useEffect, useState } from "react";
import { authenticatedFetchBlob } from "../lib/authenticated-fetch";
import type { SignaturePosee } from "./api";
import { dateSignaturePhase } from "./figement-carte";

const LABEL_PHASE: Record<"entree" | "sortie", string> = { entree: "Entrée", sortie: "Sortie" };

// Même mécanisme que PhotoThumbnail (PieceGrid.tsx) : l'endpoint
// /documents/:id/contenu exige un header Authorization, donc pas d'<img
// src="..."> direct — blob déchiffré récupéré via authenticatedFetchBlob,
// jamais d'URL publique (CLAUDE.md), révoquée au démontage.
function SignatureImage({ documentId, nomAffiche }: { documentId: string; nomAffiche: string }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    let urlCourante: string | null = null;
    let annule = false;
    authenticatedFetchBlob(`/documents/${documentId}/contenu`)
      .then(({ blob }) => {
        if (annule) {
          return;
        }
        urlCourante = URL.createObjectURL(blob);
        setUrl(urlCourante);
      })
      .catch(() => setErreur(true));
    return () => {
      annule = true;
      if (urlCourante) {
        URL.revokeObjectURL(urlCourante);
      }
    };
  }, [documentId]);

  if (erreur) {
    return (
      <div className="flex h-12 w-28 items-center justify-center rounded border border-slate-200 text-xs text-slate-400">
        Erreur
      </div>
    );
  }
  if (!url) {
    return <div className="h-12 w-28 animate-pulse rounded border border-slate-200 bg-slate-100" />;
  }
  return (
    <img
      src={url}
      alt={`Signature de ${nomAffiche}`}
      className="h-12 w-28 rounded border border-slate-200 bg-white object-contain"
    />
  );
}

function TexteSigne({ libelle, texte }: { libelle: string; texte: string | null }): React.JSX.Element {
  return (
    <div className="text-sm">
      <p className="text-xs font-medium text-slate-500">{libelle}</p>
      <p className={`whitespace-pre-wrap break-words ${texte ? "text-slate-700" : "text-slate-400"}`}>{texte ?? "Aucune"}</p>
    </div>
  );
}

function PhaseSignatures({
  phase,
  lieu,
  signataires,
  observationsBailleur,
  reservesLocataire
}: {
  phase: "entree" | "sortie";
  lieu: string | null;
  signataires: SignaturePosee[];
  observationsBailleur: string | null;
  reservesLocataire: string | null;
}): React.JSX.Element {
  const dateSignature = dateSignaturePhase(signataires, phase) ?? "—";
  const tries = [...signataires].sort((a, b) => (a.role === b.role ? 0 : a.role === "bailleur" ? -1 : 1));

  return (
    <div className="rounded-md border border-slate-100 p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
        <span className="font-semibold text-slate-700">{LABEL_PHASE[phase]}</span>
        <span>
          Fait le {dateSignature}
          {lieu ? ` à ${lieu}` : ""}
        </span>
      </div>
      <div className="space-y-2">
        {tries.map((signataire) => (
          <div
            key={`${signataire.role}-${signataire.locataireId ?? "bailleur"}`}
            className="flex items-center justify-between gap-3"
          >
            <div className="text-sm">
              <p className="font-medium text-slate-700">{signataire.nomAffiche}</p>
              <p className="text-xs text-slate-500">
                {signataire.role === "bailleur" ? "Bailleur" : "Locataire"} — Lu et approuvé
                {signataire.luEtApprouve ? " ✓" : ""}
              </p>
            </div>
            <SignatureImage documentId={signataire.documentId} nomAffiche={signataire.nomAffiche} />
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-2">
        <TexteSigne libelle="Observations du bailleur" texte={observationsBailleur} />
        <TexteSigne libelle="Réserves du locataire" texte={reservesLocataire} />
      </div>
    </div>
  );
}

// Affiche les signatures déjà posées (bailleur + locataires, par phase) —
// rien tant qu'aucune phase n'est signée (acte posé exclusivement depuis
// le parcours mobile, voir SignatureStepScreen côté mobile-web). Lecture
// seule : aucune action de signature n'est jamais possible depuis le
// desktop, et les observations et réserves générales, posées à la signature
// dans la même transaction, ne se saisissent pas ici.
export function SignaturesCard({
  signatures,
  error,
  entreeSigneeNumeriquement,
  entreePapier = null,
  sortieSignee,
  lieuEntree,
  lieuSortie,
  observationsBailleurEntree,
  reservesLocataireEntree,
  observationsBailleurSortie,
  reservesLocataireSortie
}: {
  signatures: SignaturePosee[];
  error: string | null;
  // Famille B : une entrée établie sur papier n'a aucune signature
  // numérique à montrer ici.
  entreeSigneeNumeriquement: boolean;
  // Entrée établie sur papier : une ligne d'explication à la place des
  // signatures d'entrée, pour qu'on ne la croie pas manquante.
  entreePapier?: EntreePapierEtatDesLieux | null;
  sortieSignee: boolean;
  lieuEntree: string | null;
  lieuSortie: string | null;
  observationsBailleurEntree: string | null;
  reservesLocataireEntree: string | null;
  observationsBailleurSortie: string | null;
  reservesLocataireSortie: string | null;
}): React.JSX.Element | null {
  if (!entreeSigneeNumeriquement && !entreePapier && !sortieSignee) {
    return null;
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h4 className="mb-2 text-sm font-semibold text-slate-700">Signatures</h4>
      {error && (
        <p role="alert" className="mb-2 text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="space-y-3">
        {entreePapier && (
          <div className="text-sm">
            <p className="font-medium text-slate-700">Entrée</p>
            <p className="text-slate-600">
              Signée sur papier le {formaterDateCourteFr(entreePapier.dateSignature)} à {entreePapier.lieu} par{" "}
              {formaterListeNoms(entreePapier.nomsSignataires)} : aucune signature numérique. L'original est conservé
              par le bailleur (voir « Entrée signée sur papier »).
            </p>
          </div>
        )}
        {entreeSigneeNumeriquement && (
          <PhaseSignatures
            phase="entree"
            lieu={lieuEntree}
            signataires={signatures.filter((s) => s.phase === "entree")}
            observationsBailleur={observationsBailleurEntree}
            reservesLocataire={reservesLocataireEntree}
          />
        )}
        {sortieSignee && (
          <PhaseSignatures
            phase="sortie"
            lieu={lieuSortie}
            signataires={signatures.filter((s) => s.phase === "sortie")}
            observationsBailleur={observationsBailleurSortie}
            reservesLocataire={reservesLocataireSortie}
          />
        )}
      </div>
    </div>
  );
}
