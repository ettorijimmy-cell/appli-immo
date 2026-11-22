import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { calculerMontantRecuTotal, calculerStatutPaiement } from "core";
import { appartements, baux, bien, mettreAJourFicheNonArchiveeAvecAudit, paiements, versements, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { archiverFiche, exigerNonArchiveePourArchiver } from "../common/fiche-archivee";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateVersementDto } from "./dto/create-versement.dto";

type VersementRow = typeof versements.$inferSelect;

// Commit 3b des petites suites (compléments du 2026-11-22 soir) : aucune
// écriture financière sur une échéance archivée.
const MESSAGE_ECHEANCE_ARCHIVEE = "Cette échéance est archivée : aucun versement ne peut y être ajouté.";

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
    // Échéance archivée : refus (409) après le 404 ci-dessus, avant toute
    // écriture — confirmation d'un rapprochement CSV comprise (même route).
    if (ligne.paiement.archivedAt) {
      throw new ConflictException(MESSAGE_ECHEANCE_ARCHIVEE);
    }

    return this.db.transaction(async (tx) => {
      // Sous le verrou du bail, comme la résiliation, le préavis et
      // l'archivage manuel d'une échéance (PaiementsService) : l'échéance est
      // relue après eux. Archivée entre-temps → même 409, rien n'est écrit.
      await tx.select({ id: baux.id }).from(baux).where(eq(baux.id, ligne.paiement.bailId)).for("update");
      const [paiement] = await tx.select().from(paiements).where(eq(paiements.id, dto.paiementId)).limit(1);
      if (!paiement) {
        throw new NotFoundException("Paiement introuvable");
      }
      if (paiement.archivedAt) {
        throw new ConflictException(MESSAGE_ECHEANCE_ARCHIVEE);
      }

      const [versement] = await tx
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

      await this.recalculerStatutPaiement(tx, dto.paiementId, paiement.montant);

      return this.versDto(versement);
    });
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
    // Versement déjà annulé (archivé) : 409 « Déjà annulé le … », sans
    // écriture ni recalcul du statut du paiement (petites suites, décision 4
    // du 2026-11-22). Condition répétée dans l'UPDATE (archiverFiche) :
    // deux annulations simultanées ne réussissent pas toutes les deux.
    exigerNonArchiveePourArchiver(versement, "annulé");

    // Sous le verrou du bail, comme l'ajout d'un versement, la modification
    // et l'archivage d'une échéance, la résiliation et le préavis (commit 3b
    // des petites suites, revue financial-logic-reviewer) : sans lui, le
    // statut était recalculé sur des données lues hors verrou (un versement
    // ajouté ou un montant changé en même temps n'était pas pris en compte)
    // puis écrit après coup. Ordre : bail, puis versement, puis échéance —
    // le verrou du bail sérialise tout, pas d'interblocage avec archive().
    const [echeanceLue] = await this.db
      .select({ bailId: paiements.bailId })
      .from(paiements)
      .where(eq(paiements.id, versement.paiementId))
      .limit(1);
    return this.db.transaction(async (tx) => {
      if (echeanceLue) {
        await tx.select({ id: baux.id }).from(baux).where(eq(baux.id, echeanceLue.bailId)).for("update");
      }

      const versementAnnule = await archiverFiche(
        tx,
        versements,
        id,
        {},
        this.requestContext.getUtilisateurId(),
        "Versement introuvable",
        "annulé"
      );

      // Montant de l'échéance relu sous le verrou. Échéance archivée : le
      // recalcul n'écrit rien (voir recalculerStatutPaiement).
      const [paiement] = await tx.select().from(paiements).where(eq(paiements.id, versement.paiementId)).limit(1);
      if (paiement) {
        await this.recalculerStatutPaiement(tx, versement.paiementId, paiement.montant);
      }

      return this.versDto(versementAnnule as VersementRow);
    });
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

  // N'écrit JAMAIS sur une échéance archivée (commit 3b des petites suites) :
  // condition `archived_at IS NULL` dans l'UPDATE, aucune ligne touchée
  // sinon — le statut d'une échéance archivée reste celui qu'elle avait à
  // son archivage. Seul cas encore possible : l'annulation d'un versement
  // resté actif sur une échéance archivée (ajouter() l'acceptait avant ce
  // commit) ; le versement est annulé, l'échéance n'est pas touchée.
  private async recalculerStatutPaiement(
    executeur: Pick<Database, "select" | "update">,
    paiementId: string,
    montantDu: string
  ): Promise<void> {
    const versementsActifs = await executeur
      .select()
      .from(versements)
      .where(and(eq(versements.paiementId, paiementId), isNull(versements.archivedAt)));
    const montantRecu = calculerMontantRecuTotal(versementsActifs);
    const statut = calculerStatutPaiement(montantDu, montantRecu);
    await mettreAJourFicheNonArchiveeAvecAudit(executeur, paiements, paiementId, { statut }, this.requestContext.getUtilisateurId());
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
