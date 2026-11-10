import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { appartements, bailLocataires, baux, bien, garants, mettreAJourAvecAudit, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateGarantDto } from "./dto/create-garant.dto";
import type { UpdateGarantDto } from "./dto/update-garant.dto";

type GarantRow = typeof garants.$inferSelect;

// Garantie Visale (chantier garants, 2026-11-08) : le garant est
// l'organisme, jamais une personne. Nom imposé par le serveur, prénom vide.
export const NOM_GARANT_VISALE = "Action Logement Services (Visale)";

// Champs propres à une personne : toujours vidés (null) pour un garant
// Visale, à la création comme à la modification ou au passage en Visale.
// Vidés plutôt qu'ignorés : aucune donnée personnelle ne doit rester
// attachée à un organisme (une ancienne caution passée en Visale ne garde
// pas sa date de naissance), et le bail comme l'acte n'en impriment jamais
// pour Visale. Le lien « Caution de » est aussi vidé : Visale est
// interdit en colocation.
const CHAMPS_PERSONNE_VIDES_POUR_VISALE = {
  prenom: null,
  adresse: null,
  codePostal: null,
  ville: null,
  dateNaissance: null,
  lieuNaissance: null,
  nationalite: null,
  locataireId: null
} as const;

@Injectable()
export class GarantsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  // Contrôle d'appartenance sur dto.bailId (Priorité E1, chantier scoping
  // multi-organisation, Catégorie E, 2026-09-19) : organisationId du
  // garant est résolu depuis le bail (bail -> appartement -> bien), jamais
  // depuis l'utilisateur courant — un garant est toujours rattaché à un
  // bail (bail_id NOT NULL), donc toujours déterminable sans ambiguïté,
  // même principe que depense.sciId dénormalisé depuis bien.sciId
  // (DepensesService.create). Sans ce filtre, ce mécanisme même permettait
  // à un appelant de l'organisation A d'injecter un garant (nom, date de
  // naissance, lieu de naissance, nationalité) directement dans
  // l'organisation B en fournissant un bailId de B — le cas le plus grave
  // de tout l'audit Catégorie E. eq(bien.organisationId, organisationId)
  // filtre désormais la même jointure déjà nécessaire pour résoudre
  // l'organisationId à écrire, sans requête supplémentaire. Skip si
  // organisationId absent (hors contexte HTTP, comportement préexistant
  // préservé). Même message "Bail introuvable" que pour un id inexistant —
  // aucune différence observable, même principe que le pattern 404 établi
  // pour les lectures dans tout ce chantier.
  async create(dto: CreateGarantDto) {
    const organisationId = this.requestContext.getOrganisationId();
    const [ligne] = await this.db
      .select({ organisationId: bien.organisationId })
      .from(baux)
      .innerJoin(appartements, eq(appartements.id, baux.appartementId))
      .innerJoin(bien, eq(bien.id, appartements.bienId))
      .where(and(eq(baux.id, dto.bailId), ...(organisationId ? [eq(bien.organisationId, organisationId)] : [])))
      .limit(1);
    if (!ligne) {
      throw new NotFoundException("Bail introuvable");
    }
    const valeurs =
      dto.typeGarantie === "garantie_visale"
        ? {
            ...CHAMPS_PERSONNE_VIDES_POUR_VISALE,
            nom: NOM_GARANT_VISALE,
            numeroContratVisale: dto.numeroContratVisale ?? null
          }
        : await this.valeursCautionPersonnePhysique(dto.bailId, dto);

    const [garant] = await this.db
      .insert(garants)
      .values({
        bailId: dto.bailId,
        email: dto.email,
        telephone: dto.telephone,
        typeGarantie: dto.typeGarantie,
        organisationId: ligne.organisationId,
        ...valeurs
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
    const existant = await this.resoudreGarantAvecAppartenance(id);
    const typeFinal = dto.typeGarantie ?? existant.typeGarantie;
    const modifications = await this.modificationsSelonType(existant, typeFinal, dto);

    const [garant] = await mettreAJourAvecAudit(
      this.db,
      garants,
      id,
      modifications,
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

  // Création d'une caution personne physique : nom et prénom déjà exigés
  // par CreateGarantDto. Seul un NOUVEAU « Caution de » est contrôlé.
  private async valeursCautionPersonnePhysique(bailId: string, dto: CreateGarantDto) {
    if (dto.locataireId) {
      await this.verifierLocataireAuBail(bailId, dto.locataireId);
    }
    return {
      nom: dto.nom!,
      prenom: dto.prenom!,
      adresse: dto.adresse,
      codePostal: dto.codePostal,
      ville: dto.ville,
      dateNaissance: dto.dateNaissance,
      lieuNaissance: dto.lieuNaissance,
      nationalite: dto.nationalite,
      locataireId: dto.locataireId ?? null,
      numeroContratVisale: null
    };
  }

  // Règles de modification selon le type final (chantier garants,
  // 2026-11-08) :
  // - Visale (y compris passage d'une caution en Visale) : nom imposé,
  //   champs de personne vidés, seuls numéro de contrat, e-mail et
  //   téléphone restent modifiables ;
  // - personne physique, passage depuis Visale (ou depuis une ligne
  //   « autre » existante) : nom et prénom à fournir dans la même requête
  //   (le nom enregistré est celui de l'organisme), numéro Visale effacé ;
  // - personne physique sans changement de type : comportement d'avant,
  //   numéro Visale toujours vide ;
  // - ligne « autre » existante, type inchangé : lisible et modifiable,
  //   mais jamais créée ni choisie (refusé par le DTO).
  private async modificationsSelonType(
    existant: GarantRow,
    typeFinal: GarantRow["typeGarantie"],
    dto: UpdateGarantDto
  ): Promise<Partial<typeof garants.$inferInsert>> {
    if (typeFinal === "garantie_visale") {
      return {
        typeGarantie: typeFinal,
        ...CHAMPS_PERSONNE_VIDES_POUR_VISALE,
        nom: NOM_GARANT_VISALE,
        numeroContratVisale:
          dto.numeroContratVisale !== undefined ? dto.numeroContratVisale : existant.numeroContratVisale,
        email: dto.email,
        telephone: dto.telephone
      };
    }

    // Le numéro Visale n'est jamais écrit pour un autre type que Visale.
    const reste: UpdateGarantDto = { ...dto };
    delete reste.numeroContratVisale;
    if (typeFinal === "personne_physique" && existant.typeGarantie !== "personne_physique") {
      if (!dto.nom || !dto.prenom) {
        throw new BadRequestException(
          "Passage en caution personne physique : nom et prénom de la caution requis."
        );
      }
    }
    // Rattachement « caution de » : seule une NOUVELLE valeur est contrôlée.
    // La valeur déjà enregistrée reste acceptée telle quelle, même si ce
    // locataire a quitté le bail depuis (le formulaire la renvoie avec le
    // reste des champs) ; null efface le lien.
    if (dto.locataireId && dto.locataireId !== existant.locataireId) {
      await this.verifierLocataireAuBail(existant.bailId, dto.locataireId);
    }
    return typeFinal === "personne_physique" ? { ...reste, numeroContratVisale: null } : reste;
  }

  // Le locataire dont le garant se porte caution doit être rattaché au même
  // bail (lien bail_locataires non archivé). Le contrôle porte sur le bail
  // du garant, déjà vérifié dans l'organisation courante : un locataire
  // d'une autre organisation ne peut donc jamais y être rattaché.
  private async verifierLocataireAuBail(bailId: string, locataireId: string): Promise<void> {
    const [lien] = await this.db
      .select({ id: bailLocataires.id })
      .from(bailLocataires)
      .where(
        and(
          eq(bailLocataires.bailId, bailId),
          eq(bailLocataires.locataireId, locataireId),
          isNull(bailLocataires.archivedAt)
        )
      )
      .limit(1);
    if (!lien) {
      throw new BadRequestException(
        "Le locataire choisi pour « Caution de » n'est pas rattaché à ce bail."
      );
    }
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
      nationalite: garant.nationalite,
      locataireId: garant.locataireId,
      numeroContratVisale: garant.numeroContratVisale
    };
  }
}
