export type ClassificationType = "contact" | "locataire" | "candidat" | "garant" | "non_classe";

export interface CorrespondanceClassification {
  type: "contact" | "locataire" | "candidat" | "garant";
  id: string;
}

export interface ResultatClassification {
  type: ClassificationType;
  id: string | null;
}

/**
 * Résout la classification d'un message de la boîte mail dédiée à partir
 * des correspondances EXACTES d'adresse email déjà trouvées (par l'appelant,
 * via une requête contre contact.email/locataires.email/candidat.email —
 * fonction pure, aucun accès base ici) — même discipline que
 * suggererCategorie (Charges et fiscalité) : retourne le type/id trouvé
 * SEULEMENT si EXACTEMENT une correspondance existe. Zéro correspondance
 * (aucune entité avec cette adresse) ou plusieurs (deux entités distinctes
 * partagent la même adresse, y compris deux lignes de la même table)
 * renvoient 'non_classe' — jamais un choix arbitraire entre plusieurs
 * candidats.
 */
export function resoudreClassificationEmail(
  correspondances: CorrespondanceClassification[]
): ResultatClassification {
  if (correspondances.length !== 1) {
    return { type: "non_classe", id: null };
  }
  const [seule] = correspondances;
  return { type: seule!.type, id: seule!.id };
}
