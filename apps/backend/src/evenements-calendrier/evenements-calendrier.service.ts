import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { appartements, bien, candidat, contact, evenementCalendrier, mettreAJourAvecAudit, sinistre, type Database } from "db";
import { and, eq, gte, lte } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";
import type { CreateEvenementCalendrierDto, EvenementType } from "./dto/create-evenement-calendrier.dto";
import type { UpdateEvenementCalendrierDto } from "./dto/update-evenement-calendrier.dto";

export interface FindAllEvenementsFiltres {
  periodeDebut?: string;
  periodeFin?: string;
  type?: EvenementType;
}

type EvenementRow = typeof evenementCalendrier.$inferSelect;

@Injectable()
export class EvenementsCalendrierService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService
  ) {}

  async create(userId: string, dto: CreateEvenementCalendrierDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    // Contrôle d'appartenance sur les 5 rattachements optionnels (Priorité
    // E6c, chantier scoping multi-organisation, Catégorie E, 2026-09-19) :
    // evenementCalendrier.organisationId reste bien résolu depuis
    // l'utilisateur ci-dessus (l'événement n'est jamais injecté chez un
    // tiers), mais un id étranger sur l'un de ces champs restait acceptable
    // — sa conséquence dépasse l'app elle-même : CalendrierAbonnementService
    // republie ces événements via un flux ICS public, accessible sans
    // authentification à quiconque détient l'URL. Champs optionnels :
    // aucune vérification déclenchée si absents.
    await this.verifierAppartenancesEvenement(dto);

    const [ligne] = await this.db
      .insert(evenementCalendrier)
      .values({
        type: dto.type,
        titre: dto.titre,
        dateDebut: new Date(dto.dateDebut),
        dateFin: dto.dateFin ? new Date(dto.dateFin) : undefined,
        bienId: dto.bienId,
        appartementId: dto.appartementId,
        contactId: dto.contactId,
        candidatId: dto.candidatId,
        sinistreId: dto.sinistreId,
        notes: dto.notes,
        organisationId: user.organisationId
      })
      .returning();
    if (!ligne) {
      throw new Error("Échec de la création de l'événement");
    }
    return this.versDto(ligne);
  }

  // Filtre par période sur dateDebut (un événement "commence" dans la
  // période demandée) — suffisant pour une vue calendrier simple (liste ou
  // mois), pas une vraie recherche d'intervalles chevauchants.
  async findAll(filtres: FindAllEvenementsFiltres) {
    const conditions = [];
    // Mécanisme centralisé (Commit 2, docs/data-dictionary.md) : lu
    // directement depuis le JWT décodé, jamais un lookup UsersService.
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      conditions.push(eq(evenementCalendrier.organisationId, organisationId));
    }
    if (filtres.periodeDebut) {
      conditions.push(gte(evenementCalendrier.dateDebut, new Date(filtres.periodeDebut)));
    }
    if (filtres.periodeFin) {
      conditions.push(lte(evenementCalendrier.dateDebut, new Date(filtres.periodeFin)));
    }
    if (filtres.type) {
      conditions.push(eq(evenementCalendrier.type, filtres.type));
    }
    const lignes = await this.db
      .select()
      .from(evenementCalendrier)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return lignes.map((ligne) => this.versDto(ligne));
  }

  // Contrôle d'appartenance (Sous-commit 5a, chantier scoping
  // multi-organisation, 2026-09-18) : même message que "n'existe pas",
  // aucune différence observable — même principe que B1-B6. Skip si
  // organisationId absent (hors contexte HTTP). N'affecte pas
  // findAllPourOrganisation() ci-dessous (flux ICS, chemin distinct,
  // n'appelle pas findById()). Réutilise désormais
  // resoudreEvenementAvecAppartenance() (Priorité 3a, 2026-09-19), partagée
  // avec update()/archive() ci-dessous.
  async findById(id: string) {
    const ligne = await this.resoudreEvenementAvecAppartenance(id);
    return this.versDto(ligne);
  }

  async update(id: string, dto: UpdateEvenementCalendrierDto) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19).
    await this.resoudreEvenementAvecAppartenance(id);
    // Contrôle d'appartenance sur les 5 rattachements optionnels, quand
    // fournis (Priorité E6c, Catégorie E, 2026-09-19) — même raison que
    // create() ci-dessus.
    await this.verifierAppartenancesEvenement(dto);

    const { dateDebut, dateFin, ...reste } = dto;
    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      evenementCalendrier,
      id,
      {
        ...reste,
        ...(dateDebut !== undefined && { dateDebut: new Date(dateDebut) }),
        ...(dateFin !== undefined && { dateFin: new Date(dateFin) })
      },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Événement introuvable");
    }
    return this.versDto(ligne as EvenementRow);
  }

  async archive(id: string) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19).
    await this.resoudreEvenementAvecAppartenance(id);

    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      evenementCalendrier,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Événement introuvable");
    }
    return this.versDto(ligne as EvenementRow);
  }

  // Contrôle d'appartenance partagé (Sous-commit 5a pour findById(), étendu
  // en Priorité 3a/Catégorie C à update()/archive() — 2026-09-19) : même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP).
  private async resoudreEvenementAvecAppartenance(id: string): Promise<EvenementRow> {
    const [ligne] = await this.db.select().from(evenementCalendrier).where(eq(evenementCalendrier.id, id)).limit(1);
    const organisationId = this.requestContext.getOrganisationId();
    if (!ligne || (organisationId && ligne.organisationId !== organisationId)) {
      throw new NotFoundException("Événement introuvable");
    }
    return ligne;
  }

  // Dispatch des 5 rattachements optionnels vers leur vérification
  // d'appartenance respective (Priorité E6c, chantier scoping
  // multi-organisation, Catégorie E, 2026-09-19) — appelé identiquement par
  // create() et update() ci-dessus. `!== undefined` (et non une simple
  // troncature) : distingue "champ non transmis" (aucune vérification) de
  // "champ transmis" y compris pour create(), où la distinction n'a pas
  // d'incidence pratique (JSON ne transmet jamais explicitement
  // `undefined`) mais garde le même idiome qu'update() sur les autres
  // services de ce chantier.
  private async verifierAppartenancesEvenement(dto: {
    bienId?: string;
    appartementId?: string;
    contactId?: string;
    candidatId?: string;
    sinistreId?: string;
  }): Promise<void> {
    if (dto.bienId !== undefined) {
      await this.verifierAppartenanceBien(dto.bienId);
    }
    if (dto.appartementId !== undefined) {
      await this.verifierAppartenanceAppartement(dto.appartementId);
    }
    if (dto.contactId !== undefined) {
      await this.verifierAppartenanceContact(dto.contactId);
    }
    if (dto.candidatId !== undefined) {
      await this.verifierAppartenanceCandidat(dto.candidatId);
    }
    if (dto.sinistreId !== undefined) {
      await this.verifierAppartenanceSinistre(dto.sinistreId);
    }
  }

  // Reproduit BienService.resoudreBienAvecAppartenance (privée, non
  // réutilisable ici — EvenementsCalendrierModule ne dépend pas de
  // BienModule), même pattern qu'E1-E6b. Skip si organisationId absent
  // (hors contexte HTTP).
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
  // réutilisable ici — EvenementsCalendrierModule ne dépend pas de
  // ContactsModule). Skip si organisationId absent (hors contexte HTTP).
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

  // Reproduit CandidatsService.resoudreCandidatAvecAppartenance (privée,
  // non réutilisable ici — EvenementsCalendrierModule ne dépend pas de
  // CandidatsModule). Skip si organisationId absent (hors contexte HTTP).
  private async verifierAppartenanceCandidat(candidatId: string): Promise<void> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      return;
    }
    const [ligne] = await this.db
      .select({ id: candidat.id })
      .from(candidat)
      .where(and(eq(candidat.id, candidatId), eq(candidat.organisationId, organisationId)))
      .limit(1);
    if (!ligne) {
      throw new NotFoundException("Candidat introuvable");
    }
  }

  // Reproduit SinistresService.resoudreSinistreAvecAppartenance (privée,
  // non réutilisable ici — EvenementsCalendrierModule ne dépend pas de
  // SinistresModule). Skip si organisationId absent (hors contexte HTTP).
  private async verifierAppartenanceSinistre(sinistreId: string): Promise<void> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      return;
    }
    const [ligne] = await this.db
      .select({ id: sinistre.id })
      .from(sinistre)
      .where(and(eq(sinistre.id, sinistreId), eq(sinistre.organisationId, organisationId)))
      .limit(1);
    if (!ligne) {
      throw new NotFoundException("Sinistre introuvable");
    }
  }

  // Utilisé par CalendrierAbonnementService (flux ICS) : tous les
  // événements non archivés d'une organisation, sans pagination — le
  // volume attendu (calendrier d'interventions personnel) reste faible.
  async findAllPourOrganisation(organisationId: string) {
    const lignes = await this.db
      .select()
      .from(evenementCalendrier)
      .where(eq(evenementCalendrier.organisationId, organisationId));
    return lignes.filter((ligne) => ligne.archivedAt === null).map((ligne) => this.versDto(ligne));
  }

  private versDto(ligne: EvenementRow) {
    return {
      id: ligne.id,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt,
      updatedBy: ligne.updatedBy,
      version: ligne.version,
      archivedAt: ligne.archivedAt,
      type: ligne.type,
      titre: ligne.titre,
      dateDebut: ligne.dateDebut,
      dateFin: ligne.dateFin,
      bienId: ligne.bienId,
      appartementId: ligne.appartementId,
      contactId: ligne.contactId,
      candidatId: ligne.candidatId,
      sinistreId: ligne.sinistreId,
      notes: ligne.notes,
      organisationId: ligne.organisationId
    };
  }
}
