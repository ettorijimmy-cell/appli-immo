import { Injectable, Inject } from "@nestjs/common";
import { immeublesLegacy, type Database } from "db";
import { eq } from "drizzle-orm";
import { DATABASE_CONNECTION } from "../database/database.module";

type ImmeubleRow = typeof immeublesLegacy.$inferSelect;

// Lecture seule depuis le 2026-08-27 (décision utilisateur, docs/backlog.md,
// audit du sort de la table immeubles) : create()/update()/archive()
// retirés, la table a été renommée immeubles_legacy et ne doit plus
// recevoir aucune écriture applicative. findAll()/findById() restent
// nécessaires à documents.service.ts (verifierEntiteExiste, cas
// entiteType === 'immeuble') pour que les documents historiques déjà
// rattachés à une ligne de cette table restent consultables.
@Injectable()
export class ImmeublesService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async findAll(sciId?: string) {
    const lignes = sciId
      ? await this.db.select().from(immeublesLegacy).where(eq(immeublesLegacy.sciId, sciId))
      : await this.db.select().from(immeublesLegacy);
    return lignes.map((immeuble) => this.versDto(immeuble));
  }

  async findById(id: string) {
    const [immeuble] = await this.db.select().from(immeublesLegacy).where(eq(immeublesLegacy.id, id)).limit(1);
    return immeuble ? this.versDto(immeuble) : null;
  }

  private versDto(immeuble: ImmeubleRow) {
    return {
      id: immeuble.id,
      createdAt: immeuble.createdAt,
      updatedAt: immeuble.updatedAt,
      updatedBy: immeuble.updatedBy,
      version: immeuble.version,
      archivedAt: immeuble.archivedAt,
      sciId: immeuble.sciId,
      nom: immeuble.nom,
      adresse: immeuble.adresse,
      codePostal: immeuble.codePostal,
      ville: immeuble.ville,
      typeHabitat: immeuble.typeHabitat,
      regimeJuridique: immeuble.regimeJuridique,
      anneeConstruction: immeuble.anneeConstruction,
      statut: immeuble.statut
    };
  }
}
