import { ConflictException } from "@nestjs/common";
import type { PgTable } from "drizzle-orm/pg-core";
import { CLASSIFICATION_PAR_TABLE, COLONNES_STRUCTURELLES_IGNOREES } from "./classification-colonnes-etat-des-lieux";

export interface PhasesSigneesEtatDesLieux {
  entreeSignee: boolean;
  sortieSignee: boolean;
}

// Comparaison normalisée pour la détection de "resoumission à l'identique"
// (voir plus bas) : une valeur réellement inchangée ne doit jamais être vue
// comme une modification, même quand sa représentation diffère entre la
// base et le DTO reçu.
// - decimal Postgres (etat_des_lieux_compteurs) : toujours renvoyé en
//   chaîne par le driver, le DTO envoie aussi une chaîne (@IsDecimal) mais
//   potentiellement formatée différemment ("650" vs "650.00") — comparée
//   numériquement plutôt que caractère à caractère.
// - date (etats_des_lieux.date_entree/date_sortie) : chaîne "YYYY-MM-DD"
//   des deux côtés en pratique, mais comparée par timestamp au cas où
//   l'une des deux parvenait comme objet Date (défensif).
// - `null`/`undefined` : équivalents entre eux (un champ "non renseigné"
//   ne doit jamais être vu comme différent selon qu'il est représenté par
//   l'un ou l'autre).
function valeursEquivalentes(valeurActuelle: unknown, valeurSoumise: unknown): boolean {
  if (valeurActuelle === valeurSoumise) {
    return true;
  }
  const actuelleVide = valeurActuelle === null || valeurActuelle === undefined;
  const soumiseVide = valeurSoumise === null || valeurSoumise === undefined;
  if (actuelleVide || soumiseVide) {
    return actuelleVide && soumiseVide;
  }

  if (typeof valeurActuelle === "string" && typeof valeurSoumise === "string") {
    const nombreActuel = Number(valeurActuelle);
    const nombreSoumis = Number(valeurSoumise);
    if (!Number.isNaN(nombreActuel) && !Number.isNaN(nombreSoumis)) {
      return nombreActuel === nombreSoumis;
    }
    return false;
  }

  if (typeof valeurActuelle === "number" && typeof valeurSoumise === "number") {
    return valeurActuelle === valeurSoumise;
  }

  if (valeurActuelle instanceof Date || valeurSoumise instanceof Date) {
    const tempsActuel = valeurActuelle instanceof Date ? valeurActuelle.getTime() : Date.parse(String(valeurActuelle));
    const tempsSoumis = valeurSoumise instanceof Date ? valeurSoumise.getTime() : Date.parse(String(valeurSoumise));
    return !Number.isNaN(tempsActuel) && !Number.isNaN(tempsSoumis) && tempsActuel === tempsSoumis;
  }

  return false;
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
// Fermé par défaut (revue 2026-10-25) : une clé de `champs` qui n'est NI
// une colonne structurelle (COLONNES_STRUCTURELLES_IGNOREES) NI présente
// dans la classification de la table fait échouer l'appel (Error, pas une
// ConflictException — c'est un bug de configuration, pas un refus métier)
// plutôt que de passer silencieusement. Sans ce garde, un champ du DTO
// renommé, ou une colonne ajoutée à la table sans être classée, aurait
// échappé au verrou sans qu'aucun test ne le révèle. Cette validation
// tourne AVANT toute vérification de phase, même si aucune phase n'est
// signée — c'est un contrôle de configuration, pas une règle de gel.
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
// valeur (normalisée, voir valeursEquivalentes ci-dessus), le verrou
// interdirait à tort cette mise à jour de sortie pourtant parfaitement
// légitime (régression qui aurait cassé la nature même en deux temps de
// ces tables).
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

  const champsClasses: { cle: string; valeur: unknown; categorie: "entree" | "sortie" | "commune" }[] = [];
  const champsNonClasses: string[] = [];
  for (const [cle, valeur] of Object.entries(champs)) {
    if (valeur === undefined) {
      continue;
    }
    if (COLONNES_STRUCTURELLES_IGNOREES.has(cle)) {
      continue;
    }
    const categorie = classification[cle];
    if (!categorie) {
      champsNonClasses.push(cle);
      continue;
    }
    champsClasses.push({ cle, valeur, categorie });
  }
  // Collecte TOUS les champs non classés avant de lever (plutôt que de
  // s'arrêter au premier) : un seul appel révèle d'un coup tous les
  // champs à corriger dans classification-colonnes-etat-des-lieux.ts,
  // plutôt qu'un seul à la fois au fil des relances.
  if (champsNonClasses.length > 0) {
    throw new Error(
      `Verrou de signature : champ(s) ni structurel(s) ni classé(s) entrée/sortie/commune pour cette table : ${champsNonClasses.join(", ")}. Fermé par défaut — ajoutez-les à classification-colonnes-etat-des-lieux.ts avant de les exposer en écriture.`
    );
  }

  const { entreeSignee, sortieSignee } = phasesSignees;
  if (!entreeSignee && !sortieSignee) {
    return;
  }

  for (const { cle, valeur, categorie } of champsClasses) {
    if (ligneExistante && valeursEquivalentes(ligneExistante[cle], valeur)) {
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
