import { ConflictException } from "@nestjs/common";
import type { PgTable } from "drizzle-orm/pg-core";
import { CLASSIFICATION_PAR_TABLE } from "./classification-colonnes-etat-des-lieux";

export interface PhasesSigneesEtatDesLieux {
  entreeSignee: boolean;
  sortieSignee: boolean;
}

// Verrou de signature (chantier Signatures, 2026-10-25) : une fois une
// phase signée par le bailleur, les champs qu'elle fige ne doivent plus
// pouvoir être modifiés — ni par les 11 submitX() (pièces, compteurs,
// clés, équipements divers, inventaire), ni par updateHeader().
//
// Règle (voir classification-colonnes-etat-des-lieux.ts) :
// - signature d'entrée posée : les champs "entree" ET "commune" sont figés
//   (un champ "commune" décrit le logement tel que constaté à l'entrée —
//   il n'a plus de raison de bouger une fois celle-ci actée) ; les champs
//   "sortie" restent modifiables.
// - signature de sortie posée : tout est figé, y compris "sortie".
//
// Fonction PURE (synchrone, aucun accès base) : les phases signées sont
// résolues UNE SEULE FOIS par l'appelant (resoudrePhasesSigneesEtatDesLieux,
// une requête) puis réutilisées pour chaque ligne d'une soumission en
// liste (clés, équipements divers, inventaire — jusqu'à ~90 lignes pour
// l'inventaire meublé) plutôt que requêtée à nouveau à chaque ligne.
//
// `ligneExistante` (ligne déjà en base, ou `null` pour un insert) permet de
// ne jamais bloquer une RESOUMISSION À L'IDENTIQUE d'un champ obligatoire
// du DTO qui n'est pas réellement modifié : `typeCle` (SubmitClesDto) et
// `libelle` (SubmitEquipementsDiversDto) sont des champs "commune"
// obligatoires sur CHAQUE ligne envoyée, y compris quand seul nombreSortie/
// etatSortie change à la visite de sortie — sans cette comparaison de
// valeur, le verrou interdirait à tort cette mise à jour de sortie
// pourtant parfaitement légitime (régression qui aurait cassé la nature
// même en deux temps de ces tables).
export function verifierChampsAutorises(
  phasesSignees: PhasesSigneesEtatDesLieux,
  table: PgTable,
  champs: Record<string, unknown>,
  ligneExistante: Record<string, unknown> | null
): void {
  const classification = CLASSIFICATION_PAR_TABLE.get(table);
  if (!classification) {
    throw new Error(
      "Table absente de CLASSIFICATION_PAR_TABLE — le verrou de signature ne peut pas être appliqué à cette table"
    );
  }

  const { entreeSignee, sortieSignee } = phasesSignees;
  if (!entreeSignee && !sortieSignee) {
    return;
  }

  for (const [cle, valeur] of Object.entries(champs)) {
    if (valeur === undefined) {
      continue;
    }
    const categorie = classification[cle];
    if (!categorie) {
      // Colonne structurelle (id, version...) — jamais soumise au verrou.
      continue;
    }
    if (ligneExistante && ligneExistante[cle] === valeur) {
      // Resoumission à l'identique : pas une vraie modification.
      continue;
    }
    const gele = sortieSignee || (entreeSignee && categorie !== "sortie");
    if (gele) {
      throw new ConflictException(
        `Modification refusée : le champ "${cle}" est figé par la signature ${
          sortieSignee ? "de sortie" : "d'entrée"
        } de cet état des lieux.`
      );
    }
  }
}
