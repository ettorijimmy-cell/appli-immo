import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { formaterListeNoms, resoudreModeleCourrier, type ResultatClassification } from "core";
import {
  appartements,
  bailLocataires,
  baux,
  bien,
  contact,
  locataires,
  mettreAJourAvecAudit,
  revisionLoyer,
  sinistre,
  tache,
  type Database
} from "db";
import { and, eq, isNull } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { PieceJointeEmail } from "../messagerie/smtp-envoi.service";
import { SmtpEnvoiService } from "../messagerie/smtp-envoi.service";
import { ModelesCourrierService } from "../modeles-courrier/modeles-courrier.service";
import { QuittanceDocumentDocxService } from "../quittance-document-docx/quittance-document-docx.service";

const CODE_MODELE_REVISION_LOYER = "revision_loyer";
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface FindAllTachesFiltres {
  statut?: "a_faire" | "en_cours" | "fait" | "annulee";
  type?:
    | "impaye"
    | "entretien_equipement"
    | "document_expire"
    | "quittance_mensuelle"
    | "revision_loyer"
    | "sinistre_stagnation"
    | "autre";
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
    private readonly smtpEnvoiService: SmtpEnvoiService,
    private readonly quittanceDocumentDocxService: QuittanceDocumentDocxService
  ) {}

  async findAll(filtres: FindAllTachesFiltres) {
    const conditions = [];
    // Scoping multi-tenant : toute requête HTTP réelle passe par le
    // JwtAuthGuard global (apps/backend/src/auth/auth.module.ts), donc
    // getOrganisationId() y est toujours résolvable — c'est le seul cas
    // qui compte pour l'isolation entre organisations. En dehors d'un
    // contexte HTTP (scripts, tests appelant le service directement), il
    // n'y a pas d'organisation à filtrer : on ne restreint pas. Lu
    // directement depuis le JWT décodé (Commit 2, docs/data-dictionary.md)
    // — jamais un lookup UsersService, contrairement à l'ancien pattern.
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      conditions.push(eq(tache.organisationId, organisationId));
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

  // Contrôle d'appartenance (Sous-commit 5a, chantier scoping
  // multi-organisation, 2026-09-18) : même message que "n'existe pas",
  // aucune différence observable — même principe que B1-B6. Skip si
  // organisationId absent (hors contexte HTTP). Réutilise désormais
  // resoudreTacheAvecAppartenance() (Priorité 1, Catégorie C,
  // 2026-09-18), partagée avec appliquerRevision()/envoyerNotification()
  // ci-dessous — jamais une deuxième implémentation du même contrôle.
  async findById(id: string) {
    const ligne = await this.resoudreTacheAvecAppartenance(id);
    return this.versDto(ligne);
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
    // Contrôle d'appartenance AVANT toute résolution de bail/notification
    // (Priorité 1, Catégorie C, chantier scoping multi-organisation,
    // 2026-09-18) : sans lui, cette méthode réécrivait le loyer réel d'un
    // bail étranger et fabriquait un historique de révision falsifié pour
    // n'importe quel id de tâche fourni.
    const tacheRow = await this.resoudreTacheAvecAppartenance(id);
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
    // 'en_cours' signifie "appliqué financièrement, notification en
    // attente" — c'est envoyerNotification() qui fait passer la tâche à
    // 'fait', une fois l'email réellement envoyé (Module Tâches, Étape 3,
    // 2026-09-01 : ce n'est plus bloqué sur la vérification Google OAuth).
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

  /**
   * Action générique (Module Tâches, Étape 3 — intégration Gmail,
   * 2026-09-01 ; unifiée vers la boîte mail dédiée — Module Messagerie,
   * 2026-09-16, décision actée avec Jimmy) : envoie la notification déjà
   * résolue en amont (`metadata.notificationObjet`/`notificationCorps` —
   * impaye, entretien_equipement, document_expire, quittance_mensuelle à
   * la génération ; revision_loyer une fois `appliquerRevision` passée ;
   * sinistre_stagnation vers le contact assureur) via SmtpEnvoiService,
   * puis marque la tâche `fait`. Ne tente jamais rien si le destinataire
   * ne peut pas être résolu (locataireId/sinistreId absent, ou email
   * manquant) — message clair, jamais un envoi à une adresse devinée. Si
   * l'envoi échoue (boîte mail dédiée non configurée, erreur SMTP),
   * l'exception de SmtpEnvoiService remonte telle quelle et la tâche
   * reste dans son statut actuel — jamais `fait` sur un envoi qui a
   * échoué (l'update de statut n'est atteint qu'après un envoi réussi).
   */
  async envoyerNotification(id: string) {
    // Contrôle d'appartenance AVANT toute résolution de destinataire,
    // toute génération de document et tout envoi réel (Priorité 1,
    // Catégorie C, chantier scoping multi-organisation, 2026-09-18) :
    // sans lui, un id de tâche d'une autre organisation menait à un envoi
    // d'email réel (visible du destinataire, journalisé chez le
    // fournisseur SMTP), pièce jointe financière étrangère comprise.
    const tacheRow = await this.resoudreTacheAvecAppartenance(id);
    if (tacheRow.statut !== "a_faire" && tacheRow.statut !== "en_cours") {
      throw new BadRequestException(`Cette tâche ne peut plus être envoyée (statut actuel : '${tacheRow.statut}').`);
    }

    const { notificationObjet, notificationCorps } = this.extraireMetadataNotificationEnvoi(tacheRow.metadata);

    // sinistre_stagnation : le destinataire est le contact assureur du
    // sinistre, jamais un locataire — résolution séparée (Module Suivi
    // sinistre et assurance, 2026-09-16). Tous les autres types restent
    // tenant-centric (locataireId -> locataires.email), inchangé.
    const { email: destinataireEmail, classification } =
      tacheRow.type === "sinistre_stagnation"
        ? await this.resoudreEmailAssureur(tacheRow.sinistreId)
        : await this.resoudreEmailLocataire(tacheRow.locataireId);

    let pieceJointe: PieceJointeEmail | undefined;
    if (tacheRow.type === "quittance_mensuelle") {
      if (!tacheRow.paiementId) {
        throw new BadRequestException("Tâche de quittance incomplète (paiementId manquant).");
      }
      const contenu = await this.quittanceDocumentDocxService.genererDocumentQuittanceDocx(tacheRow.paiementId);
      pieceJointe = { nomFichier: `quittance-${tacheRow.paiementId}.docx`, contenu, mimeType: MIME_DOCX };
    }

    // classification transmise explicitement (identité déjà résolue
    // ci-dessus par locataireId/contactAssureurId) — jamais laissée à une
    // résolution a posteriori par adresse email, qui n'offre aucune
    // garantie de classer correctement (bug découvert en usage réel,
    // 2026-09-16 : un envoi resté 'non_classe' malgré un email correct sur
    // le profil du locataire). Même discipline que le sélecteur manuel de
    // destinataire du Carnet de contacts.
    await this.smtpEnvoiService.envoyerEmail(
      tacheRow.organisationId,
      destinataireEmail,
      notificationObjet,
      notificationCorps,
      pieceJointe,
      classification
    );

    const [tacheMiseAJour] = await mettreAJourAvecAudit(
      this.db,
      tache,
      id,
      { statut: "fait", dateCompletion: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!tacheMiseAJour) {
      throw new NotFoundException("Tâche introuvable");
    }
    return this.versDto(tacheMiseAJour as TacheRow);
  }

  private async resoudreEmailLocataire(
    locataireId: string | null
  ): Promise<{ email: string; classification: ResultatClassification }> {
    if (!locataireId) {
      throw new BadRequestException("Aucun destinataire résolu pour cette tâche (aucun titulaire actif sur le bail).");
    }
    const [locataireDestinataire] = await this.db
      .select({ email: locataires.email })
      .from(locataires)
      .where(eq(locataires.id, locataireId))
      .limit(1);
    if (!locataireDestinataire || !locataireDestinataire.email) {
      throw new BadRequestException("Le locataire destinataire n'a pas d'adresse email renseignée.");
    }
    return { email: locataireDestinataire.email, classification: { type: "locataire", id: locataireId } };
  }

  private async resoudreEmailAssureur(
    sinistreId: string | null
  ): Promise<{ email: string; classification: ResultatClassification }> {
    if (!sinistreId) {
      throw new BadRequestException("Aucun destinataire résolu pour cette tâche (sinistreId manquant).");
    }
    const [sinistreRow] = await this.db
      .select({ contactAssureurId: sinistre.contactAssureurId })
      .from(sinistre)
      .where(eq(sinistre.id, sinistreId))
      .limit(1);
    if (!sinistreRow?.contactAssureurId) {
      throw new BadRequestException("Aucun contact assureur renseigné sur ce sinistre.");
    }
    const [contactDestinataire] = await this.db
      .select({ email: contact.email })
      .from(contact)
      .where(eq(contact.id, sinistreRow.contactAssureurId))
      .limit(1);
    if (!contactDestinataire || !contactDestinataire.email) {
      throw new BadRequestException("Le contact assureur n'a pas d'adresse email renseignée.");
    }
    return { email: contactDestinataire.email, classification: { type: "contact", id: sinistreRow.contactAssureurId } };
  }

  private extraireMetadataNotificationEnvoi(metadata: unknown): { notificationObjet: string; notificationCorps: string } {
    if (typeof metadata !== "object" || metadata === null) {
      throw new BadRequestException("Aucune notification résolue pour cette tâche.");
    }
    const m = metadata as Record<string, unknown>;
    if (typeof m.notificationObjet !== "string" || typeof m.notificationCorps !== "string") {
      throw new BadRequestException(
        m.notificationIndisponible
          ? `Notification indisponible : ${typeof m.motifNotificationIndisponible === "string" ? m.motifNotificationIndisponible : "raison inconnue"}.`
          : "Aucune notification résolue pour cette tâche."
      );
    }
    return { notificationObjet: m.notificationObjet, notificationCorps: m.notificationCorps };
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

  // Contrôle d'appartenance partagé (Sous-commit 5a pour findById(),
  // étendu en Priorité 1/Catégorie C à appliquerRevision()/
  // envoyerNotification() — 2026-09-18) : même message que "n'existe
  // pas", aucune différence observable. Skip si organisationId absent
  // (hors contexte HTTP). Renvoie la ligne brute (pas le DTO) : les deux
  // appelants ci-dessus ont besoin des colonnes internes (metadata,
  // bailId, sinistreId, paiementId, locataireId), pas de la projection
  // publique.
  private async resoudreTacheAvecAppartenance(id: string): Promise<TacheRow> {
    const [ligne] = await this.db.select().from(tache).where(eq(tache.id, id)).limit(1);
    const organisationId = this.requestContext.getOrganisationId();
    if (!ligne || (organisationId && ligne.organisationId !== organisationId)) {
      throw new NotFoundException("Tâche introuvable");
    }
    return ligne;
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
      sinistreId: ligne.sinistreId,
      dateEcheance: ligne.dateEcheance,
      dateCompletion: ligne.dateCompletion,
      periodeRecurrence: ligne.periodeRecurrence,
      notes: ligne.notes,
      metadata: ligne.metadata,
      organisationId: ligne.organisationId
    };
  }
}
