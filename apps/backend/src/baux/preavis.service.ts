import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  centimesVersMontant,
  dateFinPreavisProposee,
  montantEnCentimes,
  planRealignementEcheances,
  RefusRealignement,
  validerDeclarationPreavis,
  type EcheanceACreer,
  type EcheanceConserveePreavis,
  type MiseAJourEcheance
} from "core";
import {
  appartements,
  bailPreavis,
  baux,
  bien,
  mettreAJourAvecAudit,
  paiements,
  remboursements,
  versements,
  type Database
} from "db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { AuditService } from "../audit/audit.service";
import { dateDuJourParis } from "../common/date-paris";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { DeclarerPreavisDto } from "./dto/declarer-preavis.dto";

const CODE_POSTGRES_VIOLATION_UNICITE = "23505";

function codePostgres(erreur: unknown): string | undefined {
  const code = (erreur as { code?: unknown; cause?: { code?: unknown } } | null)?.code;
  if (typeof code === "string") {
    return code;
  }
  const codeCause = (erreur as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof codeCause === "string" ? codeCause : undefined;
}

type LignePreavis = typeof bailPreavis.$inferSelect;
type LigneBail = typeof baux.$inferSelect;

export interface Preavis {
  id: string;
  bailId: string;
  auteur: LignePreavis["auteur"];
  dateReception: string;
  modeRemise: LignePreavis["modeRemise"];
  dureeMois: number;
  motifReduit: LignePreavis["motifReduit"];
  dateFinProposee: string;
  dateFin: string;
  dateFinBailAvant: string | null;
  motifFin: LignePreavis["motifFin"];
  declareeLe: Date;
  declareePar: string;
  archivedAt: Date | null;
}

export interface EcheanceCreee extends EcheanceACreer {
  paiementId: string;
}

// Ce que l'action a fait sur les échéances de loyer (même esprit que la
// réponse de BauxService.resilier()) : jamais de remboursement automatique,
// un trop-perçu est seulement signalé.
export interface RealignementEffectue {
  echeancesRecalculees: MiseAJourEcheance[];
  echeancesArchivees: string[];
  echeancesConservees: EcheanceConserveePreavis[];
  echeancesCreees: EcheanceCreee[];
  tropPercuMoisFin: { paiementId: string; tropPercu: string; resteARembourser: string } | null;
  tropPercuTotal: string;
  resteARembourserTotal: string;
}

export interface ResultatActionPreavis {
  bailId: string;
  statut: LigneBail["statut"];
  dateFin: string | null;
  preavis: Preavis | null;
  realignement: RealignementEffectue;
}

export interface PreavisDuBail {
  actif: Preavis | null;
  historique: Preavis[];
}

function versPreavis(ligne: LignePreavis): Preavis {
  return {
    id: ligne.id,
    bailId: ligne.bailId,
    auteur: ligne.auteur,
    dateReception: ligne.dateReception,
    modeRemise: ligne.modeRemise,
    dureeMois: ligne.dureeMois,
    motifReduit: ligne.motifReduit,
    dateFinProposee: ligne.dateFinProposee,
    dateFin: ligne.dateFin,
    dateFinBailAvant: ligne.dateFinBailAvant,
    motifFin: ligne.motifFin,
    declareeLe: ligne.declareeLe,
    declareePar: ligne.declareePar,
    archivedAt: ligne.archivedAt
  };
}

// Préavis d'un bail (résiliation, conception 2 « vrai préavis », décisions
// de Jimmy du 2026-11-15, points 1 à 13 — calculs purs dans packages/core,
// baux/preavis.ts) : déclarer, corriger, annuler, consulter.
//
// Ordre des contrôles, pour chaque action :
// 1. 404 si le bail n'appartient pas à l'organisation (avant toute autre
//    réponse, rien n'est révélé) ;
// 2. 400 si la déclaration est incohérente (validerDeclarationPreavis,
//    contrôlée contre le type et la date de début du bail) ;
// 3. puis UNE transaction qui verrouille la ligne du bail (SELECT … FOR
//    UPDATE, même verrou que resilier() et le job de génération) et refuse
//    en 409 ce qui dépend de l'état du bail (statut, préavis actif, date de
//    fin dépassée pour une annulation, échéances incohérentes).
// Écritures, toutes dans cette transaction : la ligne bail_preavis
// (insertion, ou archivage « corrige » / « annule » puis insertion — jamais
// d'UPDATE des champs de fond, triggers de la migration 0079), baux.statut
// et baux.date_fin, puis les échéances de loyer selon
// planRealignementEcheances (mettreAJourAvecAudit pour les recalculs et les
// archivages, insertion pour les créations).
@Injectable()
export class PreavisService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService
  ) {}

  async declarer(bailId: string, dto: DeclarerPreavisDto): Promise<ResultatActionPreavis> {
    const { bail, organisationId } = await this.resoudreBailAvecAppartenance(bailId);
    this.verifierDeclaration(bail, dto);
    const utilisateurId = this.utilisateurObligatoire();

    return this.dansTransaction(async (tx) => {
      const bailVerrouille = await this.verrouillerBail(tx, bailId);
      if (bailVerrouille.statut === "preavis") {
        throw new ConflictException("Ce bail est déjà en préavis : corrigez le préavis existant ou annulez-le.");
      }
      if (bailVerrouille.statut !== "actif") {
        throw new ConflictException(
          `Seul un bail actif peut recevoir un préavis (statut actuel : ${bailVerrouille.statut}).`
        );
      }

      const realignement = await this.realigner(tx, bailVerrouille, null, dto.dateFin, utilisateurId);
      const nouvelle = await this.insererPreavis(tx, bailVerrouille, organisationId, dto, bailVerrouille.dateFin, utilisateurId);
      const bailApres = await this.ecrireBail(tx, bailId, { statut: "preavis", dateFin: dto.dateFin }, utilisateurId);
      await this.auditService.logCreation(
        {
          entiteType: "bail_preavis",
          entiteId: nouvelle.id,
          utilisateurId,
          donneesAvant: null,
          donneesApres: { action: "declaration", bailId, ...this.resumeDeclaration(dto) }
        },
        tx
      );
      return { bailId, statut: bailApres.statut, dateFin: bailApres.dateFin, preavis: versPreavis(nouvelle), realignement };
    });
  }

  async corriger(bailId: string, dto: DeclarerPreavisDto): Promise<ResultatActionPreavis> {
    const { bail, organisationId } = await this.resoudreBailAvecAppartenance(bailId);
    this.verifierDeclaration(bail, dto);
    const utilisateurId = this.utilisateurObligatoire();

    return this.dansTransaction(async (tx) => {
      const bailVerrouille = await this.verrouillerBail(tx, bailId);
      const active = await this.preavisActifObligatoire(tx, bailVerrouille);

      const realignement = await this.realigner(tx, bailVerrouille, active.dateFin, dto.dateFin, utilisateurId);
      // Archivée AVANT l'insertion (un seul préavis actif par bail).
      await mettreAJourAvecAudit(tx, bailPreavis, active.id, { archivedAt: new Date(), motifFin: "corrige" }, utilisateurId);
      const nouvelle = await this.insererPreavis(tx, bailVerrouille, organisationId, dto, active.dateFinBailAvant, utilisateurId);
      const bailApres = await this.ecrireBail(tx, bailId, { dateFin: dto.dateFin }, utilisateurId);
      await this.auditService.logCreation(
        {
          entiteType: "bail_preavis",
          entiteId: nouvelle.id,
          utilisateurId,
          donneesAvant: { id: active.id, dateFin: active.dateFin, dureeMois: active.dureeMois, auteur: active.auteur },
          donneesApres: { action: "correction", bailId, ...this.resumeDeclaration(dto) }
        },
        tx
      );
      return { bailId, statut: bailApres.statut, dateFin: bailApres.dateFin, preavis: versPreavis(nouvelle), realignement };
    });
  }

  async annuler(bailId: string): Promise<ResultatActionPreavis> {
    await this.resoudreBailAvecAppartenance(bailId);
    const utilisateurId = this.utilisateurObligatoire();

    return this.dansTransaction(async (tx) => {
      const bailVerrouille = await this.verrouillerBail(tx, bailId);
      const active = await this.preavisActifObligatoire(tx, bailVerrouille);
      // Décision 13 : annulable jusqu'à la date de fin incluse ; au-delà,
      // le préavis est terminé et le bail se résilie.
      if (dateDuJourParis() > active.dateFin) {
        throw new ConflictException(
          "Le préavis est terminé : il ne peut plus être annulé. Résiliez le bail à la date de fin du préavis ou avant."
        );
      }

      const realignement = await this.realigner(tx, bailVerrouille, active.dateFin, null, utilisateurId);
      const [archivee] = await mettreAJourAvecAudit(
        tx,
        bailPreavis,
        active.id,
        { archivedAt: new Date(), motifFin: "annule" },
        utilisateurId
      );
      const bailApres = await this.ecrireBail(
        tx,
        bailId,
        { statut: "actif", dateFin: active.dateFinBailAvant },
        utilisateurId
      );
      await this.auditService.logCreation(
        {
          entiteType: "bail_preavis",
          entiteId: active.id,
          utilisateurId,
          donneesAvant: { id: active.id, dateFin: active.dateFin },
          donneesApres: { action: "annulation", bailId, dateFinBailRetablie: active.dateFinBailAvant }
        },
        tx
      );
      return {
        bailId,
        statut: bailApres.statut,
        dateFin: bailApres.dateFin,
        preavis: archivee ? versPreavis(archivee as LignePreavis) : null,
        realignement
      };
    });
  }

  async consulter(bailId: string): Promise<PreavisDuBail> {
    await this.resoudreBailAvecAppartenance(bailId);
    const lignes = await this.db
      .select()
      .from(bailPreavis)
      .where(eq(bailPreavis.bailId, bailId))
      .orderBy(desc(bailPreavis.createdAt), desc(bailPreavis.id));
    const actif = lignes.find((ligne) => ligne.archivedAt === null) ?? null;
    return {
      actif: actif ? versPreavis(actif) : null,
      historique: lignes.filter((ligne) => ligne.archivedAt !== null).map(versPreavis)
    };
  }

  // --- Contrôles ---

  private async resoudreBailAvecAppartenance(bailId: string): Promise<{ bail: LigneBail; organisationId: string }> {
    const organisationIdContexte = this.requestContext.getOrganisationId();
    const [ligne] = await this.db
      .select({ bail: baux, organisationId: bien.organisationId })
      .from(baux)
      .innerJoin(appartements, eq(appartements.id, baux.appartementId))
      .innerJoin(bien, eq(bien.id, appartements.bienId))
      .where(
        and(eq(baux.id, bailId), ...(organisationIdContexte ? [eq(bien.organisationId, organisationIdContexte)] : []))
      )
      .limit(1);
    if (!ligne) {
      throw new NotFoundException("Bail introuvable");
    }
    return ligne;
  }

  private verifierDeclaration(bail: LigneBail, dto: DeclarerPreavisDto): void {
    const problemes = validerDeclarationPreavis({
      typeBail: bail.typeBail,
      auteur: dto.auteur,
      motifReduit: dto.motifReduit ?? null,
      dureeMois: dto.dureeMois,
      dateReception: dto.dateReception,
      dateFin: dto.dateFin,
      dateDebutBail: bail.dateDebut
    });
    if (problemes.length > 0) {
      throw new BadRequestException(problemes.join(" "));
    }
  }

  // Sans utilisateur, la déclaration n'aurait pas d'auteur : refus, comme la
  // remise du bail à la caution.
  private utilisateurObligatoire(): string {
    const utilisateurId = this.requestContext.getUtilisateurId();
    if (!utilisateurId) {
      throw new NotFoundException("Bail introuvable");
    }
    return utilisateurId;
  }

  private async verrouillerBail(tx: Database, bailId: string): Promise<LigneBail> {
    const [bail] = await tx.select().from(baux).where(eq(baux.id, bailId)).limit(1).for("update");
    if (!bail) {
      throw new NotFoundException("Bail introuvable");
    }
    return bail;
  }

  private async preavisActifObligatoire(tx: Database, bail: LigneBail): Promise<LignePreavis> {
    const [active] = await tx
      .select()
      .from(bailPreavis)
      .where(and(eq(bailPreavis.bailId, bail.id), isNull(bailPreavis.archivedAt)));
    if (bail.statut !== "preavis" || !active) {
      throw new ConflictException("Ce bail n'a pas de préavis en cours.");
    }
    // Garde-fou (revue du commit 3a) : baux.date_fin doit être la date de
    // fin du préavis actif, sinon le réalignement partirait d'une mauvaise
    // « ancienne fin ». PATCH /baux/:id refusera dateFin pour un bail en
    // préavis (commit 3b) ; d'ici là, toute divergence est refusée.
    if (bail.dateFin !== active.dateFin) {
      throw new ConflictException(
        "La date de fin du bail ne correspond plus à celle du préavis en cours : corrigez le préavis pour les réaligner."
      );
    }
    return active;
  }

  // --- Écritures ---

  private async insererPreavis(
    tx: Database,
    bail: LigneBail,
    organisationId: string,
    dto: DeclarerPreavisDto,
    dateFinBailAvant: string | null,
    utilisateurId: string
  ): Promise<LignePreavis> {
    const [ligne] = await tx
      .insert(bailPreavis)
      .values({
        bailId: bail.id,
        organisationId,
        auteur: dto.auteur,
        dateReception: dto.dateReception,
        modeRemise: dto.modeRemise ?? null,
        dureeMois: dto.dureeMois,
        motifReduit: dto.motifReduit ?? null,
        dateFinProposee: dateFinPreavisProposee(dto.dateReception, dto.dureeMois),
        dateFin: dto.dateFin,
        dateFinBailAvant,
        declareeLe: new Date(),
        declareePar: utilisateurId,
        updatedBy: utilisateurId
      })
      .returning();
    if (!ligne) {
      throw new Error("Échec de l'enregistrement du préavis");
    }
    return ligne;
  }

  private async ecrireBail(
    tx: Database,
    bailId: string,
    valeurs: { statut?: "actif" | "preavis"; dateFin: string | null },
    utilisateurId: string
  ): Promise<LigneBail> {
    const [bail] = await mettreAJourAvecAudit(tx, baux, bailId, valeurs, utilisateurId);
    if (!bail) {
      throw new Error("Échec de la mise à jour du bail");
    }
    return bail as LigneBail;
  }

  // Lit les échéances de loyer NON archivées du bail avec leurs versements
  // et remboursements, calcule le plan (packages/core) et l'applique.
  private async realigner(
    tx: Database,
    bail: LigneBail,
    ancienneFin: string | null,
    nouvelleFin: string | null,
    utilisateurId: string
  ): Promise<RealignementEffectue> {
    if (!bail.loyerMensuel || !bail.jourEcheance) {
      throw new ConflictException(
        "Le loyer mensuel et le jour d'échéance du bail doivent être renseignés avant de gérer un préavis."
      );
    }
    const echeances = await tx
      .select()
      .from(paiements)
      .where(and(eq(paiements.bailId, bail.id), eq(paiements.type, "loyer"), isNull(paiements.archivedAt)));
    const ids = echeances.map((echeance) => echeance.id);
    const versementsLus = ids.length > 0 ? await tx.select().from(versements).where(inArray(versements.paiementId, ids)) : [];
    const remboursementsLus =
      ids.length > 0 ? await tx.select().from(remboursements).where(inArray(remboursements.paiementId, ids)) : [];

    let plan;
    try {
      plan = planRealignementEcheances({
        bail: {
          loyerMensuel: bail.loyerMensuel,
          provisionsCharges: bail.provisionsCharges,
          dateDebut: bail.dateDebut,
          jourEcheance: bail.jourEcheance
        },
        ancienneFin,
        nouvelleFin,
        echeances: echeances.map((echeance) => ({
          id: echeance.id,
          dateEcheance: echeance.dateEcheance,
          montant: echeance.montant,
          loyerHorsCharges: echeance.loyerHorsCharges,
          charges: echeance.charges,
          statut: echeance.statut,
          versements: versementsLus.filter((v) => v.paiementId === echeance.id),
          remboursements: remboursementsLus.filter((r) => r.paiementId === echeance.id)
        })),
        dateReference: dateDuJourParis()
      });
    } catch (erreur) {
      // Refus métier (deux échéances le même mois, mois déjà remboursé à
      // remonter) : 409 avec le message de core, rien n'a été écrit (la
      // transaction est annulée). Toute autre erreur (donnée invalide,
      // versement négatif) remonte telle quelle (500, journalisée).
      if (erreur instanceof RefusRealignement) {
        throw new ConflictException(erreur.message);
      }
      throw erreur;
    }

    for (const miseAJour of plan.miseAJour) {
      const { paiementId, montant, loyerHorsCharges, charges, statut } = miseAJour;
      await mettreAJourAvecAudit(tx, paiements, paiementId, { montant, loyerHorsCharges, charges, statut }, utilisateurId);
    }
    for (const paiementId of plan.archivages) {
      await mettreAJourAvecAudit(tx, paiements, paiementId, { archivedAt: new Date() }, utilisateurId);
    }
    const echeancesCreees: EcheanceCreee[] = [];
    for (const creation of plan.creations) {
      const [ligne] = await tx
        .insert(paiements)
        .values({
          bailId: bail.id,
          type: "loyer",
          montant: creation.montant,
          loyerHorsCharges: creation.loyerHorsCharges,
          charges: creation.charges,
          dateEcheance: creation.dateEcheance
        })
        .returning({ id: paiements.id });
      if (!ligne) {
        throw new Error("Échec de la création d'une échéance de loyer");
      }
      echeancesCreees.push({ paiementId: ligne.id, ...creation });
    }

    const centimesTropPercu =
      (plan.tropPercuMoisFin ? montantEnCentimes(plan.tropPercuMoisFin.tropPercu) : 0) +
      plan.conservations.reduce((total, c) => total + montantEnCentimes(c.tropPercu), 0);
    const centimesReste =
      (plan.tropPercuMoisFin ? montantEnCentimes(plan.tropPercuMoisFin.resteARembourser) : 0) +
      plan.conservations.reduce((total, c) => total + montantEnCentimes(c.resteARembourser), 0);

    return {
      echeancesRecalculees: plan.miseAJour,
      echeancesArchivees: plan.archivages,
      echeancesConservees: plan.conservations,
      echeancesCreees,
      tropPercuMoisFin: plan.tropPercuMoisFin,
      tropPercuTotal: centimesVersMontant(centimesTropPercu),
      resteARembourserTotal: centimesVersMontant(centimesReste)
    };
  }

  private resumeDeclaration(dto: DeclarerPreavisDto): Record<string, unknown> {
    return {
      auteur: dto.auteur,
      dateReception: dto.dateReception,
      modeRemise: dto.modeRemise ?? null,
      dureeMois: dto.dureeMois,
      motifReduit: dto.motifReduit ?? null,
      dateFin: dto.dateFin
    };
  }

  // Deux actions simultanées sur le même bail : le verrou les sérialise ;
  // l'index unique partiel reste le dernier rempart (409).
  private async dansTransaction<T>(travail: (tx: Database) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(async (tx) => travail(tx as unknown as Database));
    } catch (erreur) {
      if (codePostgres(erreur) === CODE_POSTGRES_VIOLATION_UNICITE) {
        throw new ConflictException("Un autre préavis vient d'être enregistré pour ce bail : rechargez puis réessayez.");
      }
      throw erreur;
    }
  }
}
