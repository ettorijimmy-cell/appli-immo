import { date, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baux } from "./baux";
import { auditColumns } from "./columns.helpers";

// Échelle de l'état des pièces (décret n° 2016-382, art. 2 : mauvais,
// passable, bon, très bon) — volontairement distincte de l'échelle
// Bon/D'usage/Mauvais de l'inventaire meublé ci-dessous, décision assumée
// avec le propriétaire (docs/backlog.md, "État des lieux").
export const etatDesLieuxElementEtatEnum = pgEnum("etat_des_lieux_element_etat", [
  "M",
  "P",
  "B",
  "TB"
]);

// Échelle de l'inventaire meublé (mobilier/électroménager/vaisselle-linge)
// et de "ÉQUIPEMENTS DIVERS" — non harmonisée avec l'échelle ci-dessus.
export const etatDesLieuxInventaireEtatEnum = pgEnum("etat_des_lieux_inventaire_etat", [
  "bon",
  "dusage",
  "mauvais"
]);

// Les deux temps de signature (décret n° 2016-382, art. 3, 2°) : la
// signature d'entrée fige la partie entrée, la signature de sortie fige
// tout le document (voir etat-des-lieux-signature.ts). Défini ici plutôt
// que dans etat-des-lieux-signature.ts ou documents.ts : les deux
// l'importent (etat_des_lieux_signature.phase, documents
// .etat_des_lieux_phase ci-dessous), et ce fichier racine du domaine
// État des lieux n'importe lui-même ni l'un ni l'autre — évite un cycle
// d'imports (etat-des-lieux-signature.ts référence déjà documents.ts
// pour sa colonne document_id).
export const etatDesLieuxPhaseEnum = pgEnum("etat_des_lieux_phase", ["entree", "sortie"]);

// Un seul état des lieux par bail (bail_id unique) : le même document
// couvre l'entrée et la sortie (décret n° 2016-382, art. 3, 2° — "document
// unique" permettant la comparaison), pas deux enregistrements séparés.
// date_sortie et nouvelle_adresse_locataire restent nuls jusqu'à la
// visite de sortie, potentiellement des mois ou années après la création.
export const etatsDesLieux = pgTable("etats_des_lieux", {
  ...auditColumns,
  bailId: uuid("bail_id")
    .notNull()
    .unique()
    .references(() => baux.id),
  dateEntree: date("date_entree"),
  dateSortie: date("date_sortie"),
  // Seul champ "domicile" du locataire porté par ce document (décret
  // n° 2016-382, art. 2, 2° a) — connu uniquement à la sortie, jamais
  // à l'entrée. Texte libre, décision assumée avec le propriétaire.
  nouvelleAdresseLocataire: text("nouvelle_adresse_locataire"),
  // "Fait à ..." de chaque phase (chantier signatures, 2026-10-25) : posé
  // une seule fois par phase, en même temps que date_entree/date_sortie
  // (même transaction, EtatsDesLieuxSignatureService) — pas sur
  // etat_des_lieux_signature, qui porterait la même valeur en double sur
  // chaque ligne (un bailleur + N locataires signent au même endroit).
  // Reçu dans la requête de signature, défaut bien.ville si absent.
  lieuEntree: text("lieu_entree"),
  lieuSortie: text("lieu_sortie")
});
