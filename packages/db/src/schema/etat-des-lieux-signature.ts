import { sql } from "drizzle-orm";
import { boolean, check, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { documents } from "./documents";
import { etatDesLieuxPhaseEnum, etatsDesLieux } from "./etats-des-lieux";
import { locataires } from "./locataires";

// Un seul signataire côté bailleur par phase (SCI représentée par son
// gérant, ou propriétaire personne physique — jamais plusieurs signataires
// simultanés de ce côté, décision actée). Côté locataire, un signataire
// par bail_locataires actif au moment de la signature (colocation).
export const etatDesLieuxSignatureRoleEnum = pgEnum("etat_des_lieux_signature_role", ["bailleur", "locataire"]);

// Chiffré via DocumentStorageService comme les photos (CLAUDE.md,
// docs/data-dictionary.md section documents) : l'image elle-même est une
// ligne `documents` (categorie='signature', entite_type='etat_des_lieux'),
// référencée ici par document_id — jamais un second mécanisme de stockage.
// nom_affiche est saisi à la signature, éditable (cas du mandataire côté
// bailleur) : jamais relu dynamiquement depuis scis.nom_gerant/
// bien.nom_proprietaire ou locataires après signature, pour que le nom
// imprimé sur le document reste celui effectivement présenté au moment de
// signer, même si la fiche SCI/locataire change ensuite.
export const etatDesLieuxSignature = pgTable(
  "etat_des_lieux_signature",
  {
    ...auditColumns,
    etatDesLieuxId: uuid("etat_des_lieux_id")
      .notNull()
      .references(() => etatsDesLieux.id),
    phase: etatDesLieuxPhaseEnum("phase").notNull(),
    role: etatDesLieuxSignatureRoleEnum("role").notNull(),
    // NULL pour role='bailleur' (un seul bailleur, pas une ligne
    // `locataires`), requis pour role='locataire' — voir la contrainte
    // etat_des_lieux_signature_locataire_coherent ci-dessous, même
    // principe que bien_sci_id_coherent (bien.ts).
    locataireId: uuid("locataire_id").references(() => locataires.id),
    nomAffiche: text("nom_affiche").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    // Trace la case "Lu et approuvé" cochée avant signature (jamais du
    // texte libre imprimé au document — voir EtatDesLieuxDocumentDocxService
    // à venir) : doit être true avant que la ligne existe, imposé
    // applicativement (EtatsDesLieuxSignatureService), pas par une
    // contrainte CHECK — la colonne reste là pour que la donnée écrite
    // porte sa propre preuve, indépendamment de la logique applicative du
    // jour.
    luEtApprouve: boolean("lu_et_approuve").notNull().default(false),
    signeLe: timestamp("signe_le", { withTimezone: true }).notNull()
  },
  (table) => [
    check(
      "etat_des_lieux_signature_locataire_coherent",
      sql`(${table.role} = 'bailleur' AND ${table.locataireId} IS NULL) OR (${table.role} = 'locataire' AND ${table.locataireId} IS NOT NULL)`
    ),
    // Au plus une signature bailleur par phase. Partiel sur archivedAt
    // par cohérence avec le reste du schéma (CLAUDE.md, jamais de DELETE)
    // mais aucun flux applicatif ne doit jamais archiver une signature
    // posée — une signature est définitive, pas corrigible après coup.
    uniqueIndex("etat_des_lieux_signature_bailleur_phase_unique")
      .on(table.etatDesLieuxId, table.phase)
      .where(sql`${table.role} = 'bailleur' AND ${table.archivedAt} IS NULL`),
    // Au plus une signature par locataire et par phase (un même locataire
    // ne signe pas deux fois la même phase).
    uniqueIndex("etat_des_lieux_signature_locataire_phase_unique")
      .on(table.etatDesLieuxId, table.phase, table.locataireId)
      .where(sql`${table.role} = 'locataire' AND ${table.archivedAt} IS NULL`)
  ]
);
