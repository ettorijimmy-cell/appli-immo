import { useEffect, useState } from "react";
import { ApiError, authenticatedFetchBlob } from "../lib/authenticated-fetch";
import { getSignaturesPosees, type SignaturePosee } from "./api";

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

function PhaseSignatures({
  phase,
  lieu,
  signataires
}: {
  phase: "entree" | "sortie";
  lieu: string | null;
  signataires: SignaturePosee[];
}): React.JSX.Element {
  const dateSignature = signataires[0]?.signeLe ? new Date(signataires[0].signeLe).toLocaleDateString("fr-FR") : "—";
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
    </div>
  );
}

// Affiche les signatures déjà posées (bailleur + locataires, par phase) —
// rien tant qu'aucune phase n'est signée (acte posé exclusivement depuis
// le parcours mobile, voir SignatureStepScreen côté mobile-web). Lecture
// seule : aucune action de signature n'est jamais possible depuis le
// desktop.
export function SignaturesCard({
  etatDesLieuxId,
  entreeSigneeParTous,
  sortieSigneeParTous,
  lieuEntree,
  lieuSortie
}: {
  etatDesLieuxId: string;
  entreeSigneeParTous: boolean;
  sortieSigneeParTous: boolean;
  lieuEntree: string | null;
  lieuSortie: string | null;
}): React.JSX.Element | null {
  const [signatures, setSignatures] = useState<SignaturePosee[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    getSignaturesPosees(etatDesLieuxId)
      .then((donnees) => {
        if (!annule) {
          setSignatures(donnees);
        }
      })
      .catch((err: unknown) => {
        if (!annule) {
          setError(err instanceof ApiError ? err.message : "Impossible de charger les signatures");
        }
      });
    return () => {
      annule = true;
    };
  }, [etatDesLieuxId]);

  if (!entreeSigneeParTous && !sortieSigneeParTous) {
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
        {entreeSigneeParTous && (
          <PhaseSignatures phase="entree" lieu={lieuEntree} signataires={signatures.filter((s) => s.phase === "entree")} />
        )}
        {sortieSigneeParTous && (
          <PhaseSignatures phase="sortie" lieu={lieuSortie} signataires={signatures.filter((s) => s.phase === "sortie")} />
        )}
      </div>
    </div>
  );
}
