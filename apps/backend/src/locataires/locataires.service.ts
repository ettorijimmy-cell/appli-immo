import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { locataires, mettreAJourAvecAudit, type Database } from "db";
import { eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateLocataireDto } from "./dto/create-locataire.dto";
import type { UpdateLocataireDto } from "./dto/update-locataire.dto";

type LocataireRow = typeof locataires.$inferSelect;

@Injectable()
export class LocatairesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async create(dto: CreateLocataireDto) {
    const [locataire] = await this.db
      .insert(locataires)
      .values({
        nom: dto.nom,
        prenom: dto.prenom,
        email: dto.email,
        telephone: dto.telephone
      })
      .returning();
    if (!locataire) {
      throw new Error("Échec de la création du locataire");
    }
    return this.versDto(locataire);
  }

  async findAll() {
    const lignes = await this.db.select().from(locataires);
    return lignes.map((locataire) => this.versDto(locataire));
  }

  async findById(id: string) {
    const [locataire] = await this.db.select().from(locataires).where(eq(locataires.id, id)).limit(1);
    return locataire ? this.versDto(locataire) : null;
  }

  async update(id: string, dto: UpdateLocataireDto) {
    const [locataire] = await mettreAJourAvecAudit(
      this.db,
      locataires,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!locataire) {
      throw new NotFoundException("Locataire introuvable");
    }
    return this.versDto(locataire as LocataireRow);
  }

  async archive(id: string) {
    const [locataire] = await mettreAJourAvecAudit(
      this.db,
      locataires,
      id,
      { statut: "archive", archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!locataire) {
      throw new NotFoundException("Locataire introuvable");
    }
    return this.versDto(locataire as LocataireRow);
  }

  // anonymise_le (champ interne au mécanisme d'anonymisation RGPD, pas
  // encore implémenté — packages/db/src/schema/locataires.ts) n'est
  // exposé ni ici ni par le Sync Stream locataires. Aucun code frontend
  // n'en dépend en lecture.
  private versDto(locataire: LocataireRow) {
    return {
      id: locataire.id,
      createdAt: locataire.createdAt,
      updatedAt: locataire.updatedAt,
      updatedBy: locataire.updatedBy,
      version: locataire.version,
      archivedAt: locataire.archivedAt,
      nom: locataire.nom,
      prenom: locataire.prenom,
      email: locataire.email,
      telephone: locataire.telephone,
      adresse: locataire.adresse,
      codePostal: locataire.codePostal,
      ville: locataire.ville,
      dateNaissance: locataire.dateNaissance,
      statut: locataire.statut
    };
  }
}
