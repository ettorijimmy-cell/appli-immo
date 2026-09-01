import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { formaterListeNoms, resoudreModeleCourrier } from "core";
import { appartements, bailLocataires, baux, bien, locataires, mettreAJourAvecAudit, revisionLoyer, tache, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { ModelesCourrierService } from "../modeles-courrier/modeles-courrier.service";
import { UsersService } from "../users/users.service";

const CODE_MODELE_REVISION_LOYER = "revision_loyer";

export interface FindAllTachesFiltres {
  statut?: "a_faire" | "en_cours" | "fait" | "annulee";
  type?: "impaye" | "entretien_equipement" | "document_expire" | "quittance_mensuelle" | "revision_loyer" | "autre";
  bailId?: string;
  appartementId?: string;
}

type TacheRow = typeof tache.$inferSelect;

@Injectable()
export class TachesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly modelesCourrierService: ModelesCourrierService,
    private readonly usersService: UsersService
  ) {}

  async findAll(filtres: FindAllTachesFiltres) {
    const conditions = [];
    // Scoping multi-tenant : toute requête HTTP réelle passe par le
    // JwtAuthGuard global (apps/backend/src/auth/auth.module.ts), donc
    // getUtilisateurId() y est toujours résolvable — c'est le seul cas qui
    // compte pour l'isolation entre organisations. En dehors d'un contexte
    // HTTP (scripts, tests appelant le service directement), il n'y a pas
    // d'utilisateur à filtrer : on ne restreint pas, comme le reste des
    // champs d'audit qui dépendent déjà de getUtilisateurId() (ex.
    // mettreAJourAvecAudit).
    const utilisateurId = this.requestContext.getUtilisateurId();
    if (utilisateurId) {
      const utilisateur = await this.usersService.findById(utilisateurId);
      if (utilisateur) {
        conditions.push(eq(tache.organisationId, utilisateur.organisationId));
      }
    }
    if (filtres.statut) {
      conditions.push(eq(tache.statut, filtres.statut));
    }
    if (filtres.type) {
      conditions.push(eq(tache.type, filtres.type));
    }
    if (filtres.bailId) {
      conditions.push(eq(tache.bailId, filtres.bailId));
    }
    if (filtres.appartementId) {
      conditions.push(eq(tache.appartementId, filtres.appartementId));
    }
    const lignes = await this.db
      .select()
      .from(tache)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return lignes.map((ligne) => this.versDto(ligne));
  }

  async findById(id: string) {
    const [ligne] = await this.db.select().from(tache).where(eq(tache.id, id)).limit(1);
    return ligne ? this.versDto(ligne) : null;
  }

  // Action explicite plutôt qu'un update() générique sur `statut` : la
  // logique de dateCompletion (posée automatiquement) reste centralisée
  // ici, jamais répétée côté frontend.
  async marquerFait(id: string) {
    return this.changerStatut(id, "fait", new Date());
  }

  async marquerAnnulee(id: string) {
    return this.changerStatut(id, "annulee", null);
  }

  /**
   * Action dédiée, pas `marquerFait` seul : le montant proposé par le job
   * doit pouvoir être ajusté avant application, jamais appliqué
   * automatiquement (Module Tâches, Étape 5, docs/backlog.md). Crée
   * l'historique (revision_loyer), met à jour le loyer courant du bail,
   * résout la notification à partir du vrai modèle de courrier, et passe
   * la tâche à `en_cours` — jamais `fait` directement, l'envoi Gmail restant
   * hors périmètre de cette étape.
   */
  async appliquerRevision(id: string, nouveauLoyerValide: string) {
    const [tacheRow] = await this.db.select().from(tache).where(eq(tache.id, id)).limit(1);
    if (!tacheRow) {
      throw new NotFoundException("Tâche introuvable");
    }
    if (tacheRow.type !== "revision_loyer") {
      throw new BadRequestException("Cette action n'est disponible que pour une tâche de type 'revision_loyer'.");
    }
    if (tacheRow.statut !== "a_faire") {
      throw new BadRequestException(`Cette révision ne peut plus être appliquée (statut actuel : '${tacheRow.statut}').`);
    }
    if (!tacheRow.bailId || !tacheRow.dateEcheance) {
      throw new BadRequestException("Tâche de révision incomplète (bailId ou dateEcheance manquant).");
    }
    const { trimestreReference, anneeReference, indiceReferenceValeur, indicePrecedentValeur } =
      this.extraireMetadataRevision(tacheRow.metadata);

    const [bail] = await this.db.select().from(baux).where(eq(baux.id, tacheRow.bailId)).limit(1);
    if (!bail || !bail.loyerMensuel) {
      throw new NotFoundException("Bail introuvable ou sans loyer mensuel renseigné.");
    }
    const [appartement] = await this.db
      .select()
      .from(appartements)
      .where(eq(appartements.id, bail.appartementId))
      .limit(1);
    if (!appartement) {
      throw new NotFoundException("Appartement introuvable");
    }
    const [bienRow] = await this.db.select().from(bien).where(eq(bien.id, appartement.bienId)).limit(1);
    if (!bienRow) {
      throw new NotFoundException("Bien introuvable");
    }

    const dateEffet = tacheRow.dateEcheance;
    const loyerAvant = bail.loyerMensuel;

    // Historique complet : jamais de update() prévu sur revision_loyer,
    // une révision appliquée est un fait historique (docs/data-dictionary.md).
    await this.db.insert(revisionLoyer).values({
      bailId: bail.id,
      tacheId: tacheRow.id,
      dateEffet,
      loyerAvant,
      loyerApres: nouveauLoyerValide,
      trimestreReference,
      anneeReference,
      indiceReferenceValeur,
      indicePrecedentValeur,
      organisationId: tacheRow.organisationId
    });

    await mettreAJourAvecAudit(
      this.db,
      baux,
      bail.id,
      { loyerMensuel: nouveauLoyerValide },
      this.requestContext.getUtilisateurId()
    );

    const modele = await this.modelesCourrierService.findByCode(CODE_MODELE_REVISION_LOYER);
    if (!modele) {
      throw new NotFoundException(
        `Modèle de courrier '${CODE_MODELE_REVISION_LOYER}' introuvable — lancer seed:modele-revision-loyer.`
      );
    }
    const liensLocataires = await this.db
      .select()
      .from(bailLocataires)
      .where(and(eq(bailLocataires.bailId, bail.id), isNull(bailLocataires.archivedAt)));
    const locatairesDuBail = (
      await Promise.all(
        liensLocataires.map(async (lien) => {
          const [locataire] = await this.db.select().from(locataires).where(eq(locataires.id, lien.locataireId)).limit(1);
          return locataire;
        })
      )
    ).filter((l): l is NonNullable<typeof l> => l !== undefined);
    const nomLocataire = formaterListeNoms(locatairesDuBail.map((l) => `${l.prenom} ${l.nom}`));
    const libelleBien = `${bienRow.nom ?? bienRow.adresse} — n°${appartement.numero}`;

    const { objet, corps } = resoudreModeleCourrier(
      { objet: modele.objet, corps: modele.corps },
      { nomLocataire, libelleBien, loyerAvant, loyerApres: nouveauLoyerValide, dateEffet }
    );

    const metadataExistant = (tacheRow.metadata ?? {}) as Record<string, unknown>;
    // TODO: étape 3/4 — l'envoi Gmail passera ce statut à 'fait' une fois
    // l'email réellement envoyé (bloqué actuellement sur la vérification
    // Google OAuth). 'en_cours' signifie "appliqué financièrement,
    // notification en attente".
    const [tacheMiseAJour] = await mettreAJourAvecAudit(
      this.db,
      tache,
      id,
      {
        statut: "en_cours",
        metadata: { ...metadataExistant, notificationObjet: objet, notificationCorps: corps }
      },
      this.requestContext.getUtilisateurId()
    );
    if (!tacheMiseAJour) {
      throw new NotFoundException("Tâche introuvable");
    }
    return this.versDto(tacheMiseAJour as TacheRow);
  }

  private extraireMetadataRevision(metadata: unknown): {
    trimestreReference: number;
    anneeReference: number;
    indiceReferenceValeur: string;
    indicePrecedentValeur: string;
  } {
    if (typeof metadata !== "object" || metadata === null) {
      throw new BadRequestException("Métadonnées de la tâche de révision manquantes ou invalides.");
    }
    const m = metadata as Record<string, unknown>;
    if (
      typeof m.trimestreReference !== "number" ||
      typeof m.anneeReference !== "number" ||
      typeof m.indiceReferenceValeur !== "string" ||
      typeof m.indicePrecedentValeur !== "string"
    ) {
      throw new BadRequestException("Métadonnées de la tâche de révision incomplètes.");
    }
    return {
      trimestreReference: m.trimestreReference,
      anneeReference: m.anneeReference,
      indiceReferenceValeur: m.indiceReferenceValeur,
      indicePrecedentValeur: m.indicePrecedentValeur
    };
  }

  private async changerStatut(id: string, statut: "fait" | "annulee", dateCompletion: Date | null) {
    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      tache,
      id,
      { statut, dateCompletion },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Tâche introuvable");
    }
    return this.versDto(ligne as TacheRow);
  }

  private versDto(ligne: TacheRow) {
    return {
      id: ligne.id,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt,
      updatedBy: ligne.updatedBy,
      version: ligne.version,
      archivedAt: ligne.archivedAt,
      type: ligne.type,
      statut: ligne.statut,
      origine: ligne.origine,
      alerteSourceId: ligne.alerteSourceId,
      bailId: ligne.bailId,
      appartementId: ligne.appartementId,
      bienId: ligne.bienId,
      locataireId: ligne.locataireId,
      paiementId: ligne.paiementId,
      dateEcheance: ligne.dateEcheance,
      dateCompletion: ligne.dateCompletion,
      periodeRecurrence: ligne.periodeRecurrence,
      notes: ligne.notes,
      metadata: ligne.metadata,
      organisationId: ligne.organisationId
    };
  }
}
