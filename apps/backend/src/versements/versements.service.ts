import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { calculerMontantRecuTotal, calculerStatutPaiement } from "core";
import { appartements, baux, bien, mettreAJourAvecAudit, paiements, versements, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateVersementDto } from "./dto/create-versement.dto";

type VersementRow = typeof versements.$inferSelect;

@Injectable()
export class VersementsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  // versements n'a pas de colonne organisationId directe : le scoping passe
  // par une quadruple jointure versements -> paiements -> baux ->
  // appartements -> bien (bien.organisationId), la chaîne la plus longue
  // de ce chantier.
  async findAll(paiementId?: string) {
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const conditions = [
        eq(bien.organisationId, organisationId),
        ...(paiementId ? [eq(versements.paiementId, paiementId)] : [])
      ];
      const rows = await this.db
        .select({ versement: versements })
        .from(versements)
        .innerJoin(paiements, eq(paiements.id, versements.paiementId))
        .innerJoin(baux, eq(baux.id, paiements.bailId))
        .innerJoin(appartements, eq(appartements.id, baux.appartementId))
        .innerJoin(bien, eq(bien.id, appartements.bienId))
        .where(and(...conditions));
      return rows.map((row) => this.versDto(row.versement));
    }
    const lignes = paiementId
      ? await this.db.select().from(versements).where(eq(versements.paiementId, paiementId))
      : await this.db.select().from(versements);
    return lignes.map((versement) => this.versDto(versement));
  }

  // Ajoute un encaissement réel à un paiement, sans jamais écraser les
  // précédents (docs/data-dictionary.md, section "versements &
  // remboursements") — remplace l'ancien PaiementsService.enregistrer(),
  // qui écrasait montant_paye à chaque appel. Recalcule et persiste le
  // statut du paiement après ajout, jamais laissé périmé.
  //
  // Contrôle d'appartenance sur dto.paiementId (Priorité E4, chantier
  // scoping multi-organisation, Catégorie E, 2026-09-19 — signalée en
  // Priorité 3b, non corrigée à l'époque, hors périmètre Catégorie C) :
  // n'était vérifié que pour son existence — un paiementId d'une autre
  // organisation menait à créer un versement dessus PUIS à réécrire son
  // statut ("payé"/"impayé") via recalculerStatutPaiement() ci-dessous,
  // effet visible immédiatement dans le tableau de bord de l'organisation
  // propriétaire réelle. PaiementsService.resoudrePaiementAvecAppartenance()
  // n'est pas réutilisable (privée, et VersementsModule ne dépend pas de
  // PaiementsModule) : même jointure reproduite ici sur la requête déjà
  // exécutée pour récupérer paiement.montant, même pattern qu'E1/E2/E3.
  async ajouter(dto: CreateVersementDto) {
    const organisationId = this.requestContext.getOrganisationId();
    const [ligne] = await this.db
      .select({ paiement: paiements })
      .from(paiements)
      .innerJoin(baux, eq(baux.id, paiements.bailId))
      .innerJoin(appartements, eq(appartements.id, baux.appartementId))
      .innerJoin(bien, eq(bien.id, appartements.bienId))
      .where(and(eq(paiements.id, dto.paiementId), ...(organisationId ? [eq(bien.organisationId, organisationId)] : [])))
      .limit(1);
    if (!ligne) {
      throw new NotFoundException("Paiement introuvable");
    }
    const paiement = ligne.paiement;

    const [versement] = await this.db
      .insert(versements)
      .values({
        paiementId: dto.paiementId,
        montant: dto.montant,
        dateVersement: dto.dateVersement,
        mode: dto.mode,
        referenceRapprochement: dto.referenceRapprochement ?? null
      })
      .returning();
    if (!versement) {
      throw new Error("Échec de l'ajout du versement");
    }

    await this.recalculerStatutPaiement(dto.paiementId, paiement.montant);

    return this.versDto(versement);
  }

  // Annule UN versement précis (docs/data-dictionary.md — jamais une
  // action groupée qui en archive plusieurs sans identification
  // individuelle : une éventuelle sélection multiple resterait un détail
  // d'UI, plusieurs appels distincts, jamais une transaction qui en
  // archive plusieurs d'un coup). Traçabilité garantie par les colonnes
  // d'audit du versement lui-même (updated_at/updated_by/version) —
  // journal_audit n'intervient pas ici, réservé aux accès à une donnée
  // sensible (voir AuditService).
  async annuler(id: string) {
    // Contrôle d'appartenance AVANT toute lecture/écriture, y compris sur le
    // paiement lié (Priorité 3b, Catégorie C, chantier scoping
    // multi-organisation, 2026-09-19) : sans lui, un versementId d'une autre
    // organisation menait à archiver ce versement ET à recalculer/réécrire
    // le statut du paiement étranger auquel il est rattaché — deux tables
    // touchées.
    const versement = await this.resoudreVersementAvecAppartenance(id);

    const [versementAnnule] = await mettreAJourAvecAudit(
      this.db,
      versements,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!versementAnnule) {
      throw new NotFoundException("Versement introuvable");
    }

    const [paiement] = await this.db.select().from(paiements).where(eq(paiements.id, versement.paiementId)).limit(1);
    if (paiement) {
      await this.recalculerStatutPaiement(versement.paiementId, paiement.montant);
    }

    return this.versDto(versementAnnule as VersementRow);
  }

  // Contrôle d'appartenance (Priorité 3b, Catégorie C, chantier scoping
  // multi-organisation, 2026-09-19) : ce service n'a jamais eu de findById()
  // (aucun endpoint de lecture à l'unité), donc pas de helper préexistant à
  // réutiliser — extrait ici directement, utilisé par annuler() ci-dessus.
  // versements n'a pas de colonne organisationId directe (voir findAll()
  // plus haut, même chaîne de jointure). Même message que "n'existe pas",
  // aucune différence observable. Skip si organisationId absent (hors
  // contexte HTTP). ajouter() avait la même lacune (aucun contrôle
  // d'appartenance sur dto.paiementId) — corrigée en Priorité E4
  // (2026-09-19).
  private async resoudreVersementAvecAppartenance(id: string): Promise<VersementRow> {
    const [versement] = await this.db.select().from(versements).where(eq(versements.id, id)).limit(1);
    if (!versement) {
      throw new NotFoundException("Versement introuvable");
    }
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const [ligne] = await this.db
        .select({ id: versements.id })
        .from(versements)
        .innerJoin(paiements, eq(paiements.id, versements.paiementId))
        .innerJoin(baux, eq(baux.id, paiements.bailId))
        .innerJoin(appartements, eq(appartements.id, baux.appartementId))
        .innerJoin(bien, eq(bien.id, appartements.bienId))
        .where(and(eq(versements.id, id), eq(bien.organisationId, organisationId)))
        .limit(1);
      if (!ligne) {
        throw new NotFoundException("Versement introuvable");
      }
    }
    return versement;
  }

  private async recalculerStatutPaiement(paiementId: string, montantDu: string): Promise<void> {
    const versementsActifs = await this.db
      .select()
      .from(versements)
      .where(and(eq(versements.paiementId, paiementId), isNull(versements.archivedAt)));
    const montantRecu = calculerMontantRecuTotal(versementsActifs);
    const statut = calculerStatutPaiement(montantDu, montantRecu);
    await mettreAJourAvecAudit(this.db, paiements, paiementId, { statut }, this.requestContext.getUtilisateurId());
  }

  // reference_rapprochement (libellé brut d'une ligne de relevé bancaire,
  // contenu externe non maîtrisé, packages/db/src/schema/versements.ts)
  // n'est ni exposé ici ni réplicable par le Sync Stream versements
  // (docs/backlog.md, chantier PowerSync) — le frontend ne fait que
  // l'écrire (RapprochementCsvView.tsx) via CreateVersementDto, jamais le
  // relire.
  private versDto(versement: VersementRow) {
    return {
      id: versement.id,
      createdAt: versement.createdAt,
      updatedAt: versement.updatedAt,
      updatedBy: versement.updatedBy,
      version: versement.version,
      archivedAt: versement.archivedAt,
      paiementId: versement.paiementId,
      montant: versement.montant,
      dateVersement: versement.dateVersement,
      mode: versement.mode
    };
  }
}
