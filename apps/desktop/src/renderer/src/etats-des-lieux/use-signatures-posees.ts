import { useEffect, useState } from "react";
import { ApiError } from "../lib/authenticated-fetch";
import { getSignaturesPosees, type SignaturePosee } from "./api";

// Relu quand une phase vient d'être signée : la carte Signatures et les
// badges de figement partagent cette même lecture.
export function useSignaturesPosees(
  etatDesLieuxId: string | null,
  entreeSignee: boolean,
  sortieSignee: boolean
): { signatures: SignaturePosee[]; erreur: string | null } {
  const [signatures, setSignatures] = useState<SignaturePosee[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!etatDesLieuxId || (!entreeSignee && !sortieSignee)) {
      return;
    }
    let annule = false;
    getSignaturesPosees(etatDesLieuxId)
      .then((donnees) => {
        if (!annule) {
          setSignatures(donnees);
          setErreur(null);
        }
      })
      .catch((err: unknown) => {
        if (!annule) {
          setErreur(err instanceof ApiError ? err.message : "Impossible de charger les signatures");
        }
      });
    return () => {
      annule = true;
    };
  }, [etatDesLieuxId, entreeSignee, sortieSignee]);

  return { signatures, erreur };
}
