import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { appartements, bien, contact, mettreAJourAvecAudit, sinistre, type Database } from "db";
import { and, eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";
import type { CreateSinistreDto } from "./dto/create-sinistre.dto";
import type { UpdateSinistreDto } from "./dto/update-sinistre.dto";

type SinistreRow = typeof sinistre.$inferSelect;

// Module Suivi sinistre et assurance (2026-09-16). Objectif principal :
// détecter la stagnation d'un dossier (voir AlertesJobService.
// genererAlertesSinistreStagnation) — cette classe reste un CRUD simple,
// la logique de détection vit dans packages/core/alertes (CLAUDE.md).
@Injectable()
export class SinistresService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService
  ) {}

  async create(userId: string, dto: CreateSinistreDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    // Contrôle d'appartenance sur les 3 rattachements optionnels (Priorité
    // E6d, chantier scoping multi-organisation, Catégorie E, 2026-09-19) :
    // sinistre.organisationId reste bien résolu depuis l'utilisateur
    // ci-dessus (le sinistre n'est jamais injecté chez un tiers), mais un id
    // étranger sur l'un de ces champs restait acceptable — sa conséquence :
    // toute vue résolvant ce champ pour l'affichage (adresse du bien, nom
    // de l'assureur) exposait des données d'une autre organisation. Champs
    // optionnels : aucune vérification déclenchée si absents.
    await this.verifierAppartenancesSinistre(dto);

    const [ligne] = await this.db
      .insert(sinistre)
      .values({
        type: dto.type,
        bienId: dto.bienId,
        appartementId: dto.appartementId,
        contactAssureurId: dto.contactAssureurId,
        dateDeclaration: dto.dateDeclaration,
        description: dto.description,
        montantReclame: dto.montantReclame,
        montantIndemnise: dto.montantIndemnise,
        franchise: dto.franchise,
        notes: dto.notes,
        organisationId: user.organisationId
      })
      .returning();
    if (!ligne) {
      throw new Error("Échec de la création du sinistre");
    }
    return this.versDto(ligne);
  }

  // Même pattern de scoping que CandidatsService/ContactsService — no-op
  // en dehors d'un contexte HTTP (scripts/tests directs). Mécanisme
  // centralisé (Commit 2, docs/data-dictionary.md) : lu directement
  // depuis le JWT décodé, jamais un lookup UsersService.
  async findAll() {
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const lignes = await this.db.select().from(sinistre).where(eq(sinistre.organisationId, organisationId));
      return lignes.map((ligne) => this.versDto(ligne));
    }
    const lignes = await this.db.select().from(sinistre);
    return lignes.map((ligne) => this.versDto(ligne));
  }

  // Contrôle d'appartenance (Sous-commit 5a, chantier scoping
  // multi-organisation, 2026-09-18) : même message que "n'existe pas",
  // aucune différence observable — même principe que B1-B6. Skip si
  // organisationId absent (hors contexte HTTP). Réutilise désormais
  // resoudreSinistreAvecAppartenance() (Priorité 3a, 2026-09-19), partagée
  // avec update()/archive() ci-dessous.
  async findById(id: string) {
    const ligne = await this.resoudreSinistreAvecAppartenance(id);
    return this.versDto(ligne);
  }

  // dateChangementStatut n'est mise à jour que si le statut soumis diffère
  // RÉELLEMENT de l'actuel (jamais sur un update qui laisse le statut
  // inchangé, ex. correction d'un montant) — c'est la seule donnée que lit
  // calculerAlerteSinistreStagnation, une écriture non conditionnelle la
  // ferait dériver de son sens ("depuis quand ce statut n'a pas bougé").
  async update(id: string, dto: UpdateSinistreDto) {
    // Contrôle d'appartenance AVANT toute lecture/écriture (Priorité 3a,
    // Catégorie C, chantier scoping multi-organisation, 2026-09-19).
    const actuel = await this.resoudreSinistreAvecAppartenance(id);
    // Contrôle d'appartenance sur les 3 rattachements optionnels, quand
    // fournis (Priorité E6d, Catégorie E, 2026-09-19) — même raison que
    // create() ci-dessus.
    await this.verifierAppartenancesSinistre(dto);

    const statutChange = dto.statut !== undefined && dto.statut !== actuel.statut;

    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      sinistre,
      id,
      { ...dto, ...(statutChange && { dateChangementStatut: new Date() }) },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Sinistre introuvable");
    }
    return this.versDto(ligne as SinistreRow);
  }

  async archive(id: string) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19).
    await this.resoudreSinistreAvecAppartenance(id);

    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      sinistre,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Sinistre introuvable");
    }
    return this.versDto(ligne as SinistreRow);
  }

  // Contrôle d'appartenance partagé (Sous-commit 5a pour findById(), étendu
  // en Priorité 3a/Catégorie C à update()/archive() — 2026-09-19) : même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP).
  private async resoudreSinistreAvecAppartenance(id: string): Promise<SinistreRow> {
    const [ligne] = await this.db.select().from(sinistre).where(eq(sinistre.id, id)).limit(1);
    const organisationId = this.requestContext.getOrganisationId();
    if (!ligne || (organisationId && ligne.organisationId !== organisationId)) {
      throw new NotFoundException("Sinistre introuvable");
    }
    return ligne;
  }

  // Dispatch des 3 rattachements optionnels vers leur vérification
  // d'appartenance respective (Priorité E6d, chantier scoping
  // multi-organisation, Catégorie E, 2026-09-19) — appelé identiquement par
  // create() et update() ci-dessus. `!== undefined` : distingue "champ non
  // transmis" (aucune vérification) de "champ transmis", même idiome
  // qu'EvenementsCalendrierService.verifierAppartenancesEvenement (E6c).
  private async verifierAppartenancesSinistre(dto: {
    bienId?: string;
    appartementId?: string;
    contactAssureurId?: string;
  }): Promise<void> {
    if (dto.bienId !== undefined) {
      await this.verifierAppartenanceBien(dto.bienId);
    }
    if (dto.appartementId !== undefined) {
      await this.verifierAppartenanceAppartement(dto.appartementId);
    }
    if (dto.contactAssureurId !== undefined) {
      await this.verifierAppartenanceContact(dto.contactAssureurId);
    }
  }

  // Reproduit BienService.resoudreBienAvecAppartenance (privée, non
  // réutilisable ici — SinistresModule ne dépend pas de BienModule), même
  // pattern qu'E1-E6c. Skip si organisationId absent (hors contexte HTTP).
  private async verifierAppartenanceBien(bienId: string): Promise<void> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      return;
    }
    const [ligne] = await this.db
      .select({ id: bien.id })
      .from(bien)
      .where(and(eq(bien.id, bienId), eq(bien.organisationId, organisationId)))
      .limit(1);
    if (!ligne) {
      throw new NotFoundException("Bien introuvable");
    }
  }

  // Reproduit AppartementsService.resoudreAppartementAvecAppartenance
  // (privée, non réutilisable ici), même pattern que
  // CandidatsService.verifierAppartenanceAppartement (E6a) : appartements
  // n'a pas de colonne organisationId propre, jointure via bien requise.
  // Skip si organisationId absent (hors contexte HTTP).
  private async verifierAppartenanceAppartement(appartementId: string): Promise<void> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      return;
    }
    const [ligne] = await this.db
      .select({ id: appartements.id })
      .from(appartements)
      .innerJoin(bien, eq(bien.id, appartements.bienId))
      .where(and(eq(appartements.id, appartementId), eq(bien.organisationId, organisationId)))
      .limit(1);
    if (!ligne) {
      throw new NotFoundException("Appartement introuvable");
    }
  }

  // Reproduit ContactsService.resoudreContactAvecAppartenance (privée, non
  // réutilisable ici — SinistresModule ne dépend pas de ContactsModule).
  // Skip si organisationId absent (hors contexte HTTP).
  private async verifierAppartenanceContact(contactId: string): Promise<void> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      return;
    }
    const [ligne] = await this.db
      .select({ id: contact.id })
      .from(contact)
      .where(and(eq(contact.id, contactId), eq(contact.organisationId, organisationId)))
      .limit(1);
    if (!ligne) {
      throw new NotFoundException("Contact introuvable");
    }
  }

  private versDto(ligne: SinistreRow) {
    return {
      id: ligne.id,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt,
      updatedBy: ligne.updatedBy,
      version: ligne.version,
      archivedAt: ligne.archivedAt,
      type: ligne.type,
      statut: ligne.statut,
      dateChangementStatut: ligne.dateChangementStatut,
      bienId: ligne.bienId,
      appartementId: ligne.appartementId,
      contactAssureurId: ligne.contactAssureurId,
      dateDeclaration: ligne.dateDeclaration,
      description: ligne.description,
      montantReclame: ligne.montantReclame,
      montantIndemnise: ligne.montantIndemnise,
      franchise: ligne.franchise,
      notes: ligne.notes,
      organisationId: ligne.organisationId
    };
  }
}
