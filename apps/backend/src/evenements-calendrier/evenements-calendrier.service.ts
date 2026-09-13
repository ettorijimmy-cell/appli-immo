import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { evenementCalendrier, mettreAJourAvecAudit, type Database } from "db";
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
    const utilisateurId = this.requestContext.getUtilisateurId();
    if (utilisateurId) {
      const utilisateur = await this.usersService.findById(utilisateurId);
      if (utilisateur) {
        conditions.push(eq(evenementCalendrier.organisationId, utilisateur.organisationId));
      }
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

  async findById(id: string) {
    const [ligne] = await this.db.select().from(evenementCalendrier).where(eq(evenementCalendrier.id, id)).limit(1);
    return ligne ? this.versDto(ligne) : null;
  }

  async update(id: string, dto: UpdateEvenementCalendrierDto) {
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
      notes: ligne.notes,
      organisationId: ligne.organisationId
    };
  }
}
