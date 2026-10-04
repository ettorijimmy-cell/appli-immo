import { Inject, Injectable } from "@nestjs/common";
import {
  appartements,
  baux,
  bien,
  candidat,
  depense,
  documents,
  equipements,
  etatsDesLieux,
  garants,
  immeublesLegacy,
  locataires,
  organisationSci,
  paiements,
  sinistre,
  type Database
} from "db";
import { and, eq, inArray } from "drizzle-orm";
import { DATABASE_CONNECTION } from "../database/database.module";
import { DOCUMENT_ENTITE_TYPES, type DocumentEntiteType } from "../documents/dto/create-document.dto";

// Extrait de DocumentsService (chantier scoping multi-organisation,
// Commit 4, sous-commit 4c, 2026-09-18) — partagé ici pour qu'AlertesService
// (audit Catégorie « alertes », 2026-10-03) puisse réutiliser exactement les
// mêmes chemins de résolution sans les dupliquer, plutôt que de laisser
// deux copies indépendantes du même calcul dériver avec le temps.
// DocumentsService reste le seul appelant des 11 cas ci-dessous ; Alertes
// n'en utilise que 2 (`bail`, `sinistre`) directement, plus les 3 méthodes
// supplémentaires (paiement, équipement, document) construites par-dessus.
@Injectable()
export class OrganisationResolutionService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  // Une méthode par entiteType, jamais un chemin de jointure généralisé :
  // 6 des 11 cas ont une colonne organisationId propre (locataire, garant,
  // bien, depense, candidat, sinistre), les 5 autres nécessitent une
  // chaîne de jointure jusqu'à bien.organisationId — deux via
  // organisation_sci (sci, immeuble, qui n'ont ni l'un ni l'autre de
  // colonne/FK directe vers une organisation), trois via bien directement
  // (appartement : 1 jointure ; bail : 2 ; etat_des_lieux : 3). Résolution
  // en deux temps (ids valides d'abord, puis IN) comme dans
  // ScisService/ImmeublesService.findAll() (Commit 4a) — jamais problématique
  // à l'échelle réelle de l'application (~20 logements, vérifié en base de
  // dev : 4 lignes au maximum dans n'importe laquelle des tables cibles).
  async resoudreEntiteIdsOrganisation(entiteType: DocumentEntiteType, organisationId: string): Promise<string[]> {
    switch (entiteType) {
      case "sci": {
        const lignes = await this.db
          .select({ id: organisationSci.sciId })
          .from(organisationSci)
          .where(eq(organisationSci.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "immeuble": {
        const sciIds = await this.resoudreEntiteIdsOrganisation("sci", organisationId);
        if (sciIds.length === 0) {
          return [];
        }
        const lignes = await this.db
          .select({ id: immeublesLegacy.id })
          .from(immeublesLegacy)
          .where(inArray(immeublesLegacy.sciId, sciIds));
        return lignes.map((ligne) => ligne.id);
      }
      case "appartement": {
        const lignes = await this.db
          .select({ id: appartements.id })
          .from(appartements)
          .innerJoin(bien, eq(bien.id, appartements.bienId))
          .where(eq(bien.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "locataire": {
        const lignes = await this.db
          .select({ id: locataires.id })
          .from(locataires)
          .where(eq(locataires.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "bail": {
        const lignes = await this.db
          .select({ id: baux.id })
          .from(baux)
          .innerJoin(appartements, eq(appartements.id, baux.appartementId))
          .innerJoin(bien, eq(bien.id, appartements.bienId))
          .where(eq(bien.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "etat_des_lieux": {
        const lignes = await this.db
          .select({ id: etatsDesLieux.id })
          .from(etatsDesLieux)
          .innerJoin(baux, eq(baux.id, etatsDesLieux.bailId))
          .innerJoin(appartements, eq(appartements.id, baux.appartementId))
          .innerJoin(bien, eq(bien.id, appartements.bienId))
          .where(eq(bien.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "garant": {
        const lignes = await this.db
          .select({ id: garants.id })
          .from(garants)
          .where(eq(garants.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "bien": {
        const lignes = await this.db.select({ id: bien.id }).from(bien).where(eq(bien.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "depense": {
        const lignes = await this.db
          .select({ id: depense.id })
          .from(depense)
          .where(eq(depense.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "candidat": {
        const lignes = await this.db
          .select({ id: candidat.id })
          .from(candidat)
          .where(eq(candidat.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "sinistre": {
        const lignes = await this.db
          .select({ id: sinistre.id })
          .from(sinistre)
          .where(eq(sinistre.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
    }
  }

  // Module Régularisation des charges, Audit scoping alertes (2026-10-03) —
  // `impaye` cible `paiements`, qui n'a ni colonne organisationId ni
  // appartenance à `DocumentEntiteType` (aucun document ne se rattache
  // directement à un paiement). Une jointure de plus que `bail`
  // (resoudreEntiteIdsOrganisation ci-dessus) : paiements n'a que bailId,
  // jamais bienId/appartementId directement.
  async resoudrePaiementIdsOrganisation(organisationId: string): Promise<string[]> {
    const lignes = await this.db
      .select({ id: paiements.id })
      .from(paiements)
      .innerJoin(baux, eq(baux.id, paiements.bailId))
      .innerJoin(appartements, eq(appartements.id, baux.appartementId))
      .innerJoin(bien, eq(bien.id, appartements.bienId))
      .where(eq(bien.organisationId, organisationId));
    return lignes.map((ligne) => ligne.id);
  }

  // `entretien_equipement` cible `equipements` — même raisonnement que
  // `resoudrePaiementIdsOrganisation` ci-dessus, mais `equipements` a
  // directement appartementId (pas besoin de passer par bailId) : une seule
  // jointure de moins que paiements, autant que `appartement`.
  async resoudreEquipementIdsOrganisation(organisationId: string): Promise<string[]> {
    const lignes = await this.db
      .select({ id: equipements.id })
      .from(equipements)
      .innerJoin(appartements, eq(appartements.id, equipements.appartementId))
      .innerJoin(bien, eq(bien.id, appartements.bienId))
      .where(eq(bien.organisationId, organisationId));
    return lignes.map((ligne) => ligne.id);
  }

  // `document_expire`/`document_expire_proche` ciblent `documents` —
  // DOUBLE résolution polymorphe : `documents.entiteId` est lui-même
  // polymorphe (voir packages/db/src/schema/documents.ts), donc valider
  // qu'un document appartient à l'organisation nécessite de résoudre, pour
  // CHACUN des 11 entiteType de `documents`, l'ensemble de ses ids valides
  // (via resoudreEntiteIdsOrganisation ci-dessus), puis de ne garder que les
  // lignes `documents` dont (entiteType, entiteId) tombe dans cet ensemble
  // — même principe que `DocumentsService.resoudreDocumentAvecAppartenance`,
  // mais retourne une liste d'ids plutôt que de valider un seul document par
  // id (forme batch, cohérente avec l'usage depuis `findAll`).
  async resoudreDocumentIdsOrganisation(organisationId: string): Promise<string[]> {
    const idsParType = await Promise.all(
      DOCUMENT_ENTITE_TYPES.map(async (type) => {
        const idsValides = await this.resoudreEntiteIdsOrganisation(type, organisationId);
        if (idsValides.length === 0) {
          return [];
        }
        const lignes = await this.db
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.entiteType, type), inArray(documents.entiteId, idsValides)));
        return lignes.map((ligne) => ligne.id);
      })
    );
    return idsParType.flat();
  }
}
