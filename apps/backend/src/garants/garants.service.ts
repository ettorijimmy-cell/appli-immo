import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { appartements, baux, bien, garants, mettreAJourAvecAudit, type Database } from "db";
import { and, eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateGarantDto } from "./dto/create-garant.dto";
import type { UpdateGarantDto } from "./dto/update-garant.dto";

type GarantRow = typeof garants.$inferSelect;

@Injectable()
export class GarantsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async create(dto: CreateGarantDto) {
    // organisationId résolu depuis le bail (bail -> appartement -> bien),
    // jamais depuis l'utilisateur courant — un garant est toujours
    // rattaché à un bail (bail_id NOT NULL), donc toujours déterminable
    // sans ambiguïté, même principe que depense.sciId dénormalisé depuis
    // bien.sciId (DepensesService.create).
    const [ligne] = await this.db
      .select({ organisationId: bien.organisationId })
      .from(baux)
      .innerJoin(appartements, eq(appartements.id, baux.appartementId))
      .innerJoin(bien, eq(bien.id, appartements.bienId))
      .where(eq(baux.id, dto.bailId))
      .limit(1);
    if (!ligne) {
      throw new NotFoundException("Bail introuvable");
    }

    const [garant] = await this.db
      .insert(garants)
      .values({
        bailId: dto.bailId,
        nom: dto.nom,
        prenom: dto.prenom,
        email: dto.email,
        telephone: dto.telephone,
        typeGarantie: dto.typeGarantie,
        dateNaissance: dto.dateNaissance,
        lieuNaissance: dto.lieuNaissance,
        nationalite: dto.nationalite,
        organisationId: ligne.organisationId
      })
      .returning();
    if (!garant) {
      throw new Error("Échec de la création du garant");
    }
    return this.versDto(garant);
  }

  // Module Carnet de contacts (2026-09-13) : scoping multi-tenant ajouté
  // ici — même mécanisme que LocatairesService.findAll() ci-contre.
  async findAll(bailId?: string) {
    const conditions = [];
    if (bailId) {
      conditions.push(eq(garants.bailId, bailId));
    }
    // Mécanisme centralisé (Commit 2, docs/data-dictionary.md) : lu
    // directement depuis le JWT décodé, jamais un lookup UsersService.
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      conditions.push(eq(garants.organisationId, organisationId));
    }
    const lignes =
      conditions.length > 0
        ? await this.db
            .select()
            .from(garants)
            .where(and(...conditions))
        : await this.db.select().from(garants);
    return lignes.map((garant) => this.versDto(garant));
  }

  // Contrôle d'appartenance (Sous-commit 5a, chantier scoping
  // multi-organisation, 2026-09-18) : même message que "n'existe pas",
  // aucune différence observable — même principe que B1-B6. Skip si
  // organisationId absent (hors contexte HTTP). Réutilise désormais
  // resoudreGarantAvecAppartenance() (Priorité 3a, 2026-09-19), partagée
  // avec update()/archive() ci-dessous.
  async findById(id: string) {
    const garant = await this.resoudreGarantAvecAppartenance(id);
    return this.versDto(garant);
  }

  async update(id: string, dto: UpdateGarantDto) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19).
    await this.resoudreGarantAvecAppartenance(id);

    const [garant] = await mettreAJourAvecAudit(
      this.db,
      garants,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!garant) {
      throw new NotFoundException("Garant introuvable");
    }
    return this.versDto(garant as GarantRow);
  }

  async archive(id: string) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19).
    await this.resoudreGarantAvecAppartenance(id);

    const [garant] = await mettreAJourAvecAudit(
      this.db,
      garants,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!garant) {
      throw new NotFoundException("Garant introuvable");
    }
    return this.versDto(garant as GarantRow);
  }

  // Contrôle d'appartenance partagé (Sous-commit 5a pour findById(), étendu
  // en Priorité 3a/Catégorie C à update()/archive() — 2026-09-19) : même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP).
  private async resoudreGarantAvecAppartenance(id: string): Promise<GarantRow> {
    const [garant] = await this.db.select().from(garants).where(eq(garants.id, id)).limit(1);
    const organisationId = this.requestContext.getOrganisationId();
    if (!garant || (organisationId && garant.organisationId !== organisationId)) {
      throw new NotFoundException("Garant introuvable");
    }
    return garant;
  }

  // profession/revenus (données financières précises,
  // packages/db/src/schema/garants.ts) ne sont exposés ni ici ni par le
  // Sync Stream garants. Absents même de l'interface Garant du frontend
  // desktop — aucun code n'en dépend en lecture.
  private versDto(garant: GarantRow) {
    return {
      id: garant.id,
      createdAt: garant.createdAt,
      updatedAt: garant.updatedAt,
      updatedBy: garant.updatedBy,
      version: garant.version,
      archivedAt: garant.archivedAt,
      bailId: garant.bailId,
      nom: garant.nom,
      prenom: garant.prenom,
      email: garant.email,
      telephone: garant.telephone,
      typeGarantie: garant.typeGarantie,
      adresse: garant.adresse,
      codePostal: garant.codePostal,
      ville: garant.ville,
      dateNaissance: garant.dateNaissance,
      lieuNaissance: garant.lieuNaissance,
      nationalite: garant.nationalite
    };
  }
}
