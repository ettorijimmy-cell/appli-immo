import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { contact, mettreAJourAvecAudit, type Database } from "db";
import { eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { GarantsService } from "../garants/garants.service";
import { LocatairesService } from "../locataires/locataires.service";
import { UsersService } from "../users/users.service";
import type { CreateContactDto } from "./dto/create-contact.dto";
import type { UpdateContactDto } from "./dto/update-contact.dto";

type ContactRow = typeof contact.$inferSelect;

export interface ContactUnifie {
  // "locataire"/"garant" pour les entités déjà gérées ailleurs (lecture
  // seule ici), sinon le rôle du contact professionnel — pas de valeur
  // "contact" générique, le type EST l'information utile à l'affichage.
  type: "locataire" | "garant" | ContactRow["role"];
  id: string;
  nom: string;
  telephone: string | null;
  email: string | null;
  // Renseigné uniquement pour type === "garant" : un garant n'a pas de
  // fiche autonome, la navigation se fait vers l'onglet Bail de
  // l'appartement (résolution bailId -> appartementId côté frontend,
  // même deep-link que le Module 8).
  bailId?: string;
}

@Injectable()
export class ContactsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService,
    private readonly locatairesService: LocatairesService,
    private readonly garantsService: GarantsService
  ) {}

  async create(userId: string, dto: CreateContactDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }

    const [ligne] = await this.db
      .insert(contact)
      .values({
        nom: dto.nom,
        typeEntite: dto.typeEntite,
        role: dto.role,
        telephone: dto.telephone,
        email: dto.email,
        notes: dto.notes,
        organisationId: user.organisationId
      })
      .returning();
    if (!ligne) {
      throw new Error("Échec de la création du contact");
    }
    return this.versDto(ligne);
  }

  async findAll() {
    const utilisateurId = this.requestContext.getUtilisateurId();
    if (utilisateurId) {
      const utilisateur = await this.usersService.findById(utilisateurId);
      if (utilisateur) {
        const lignes = await this.db.select().from(contact).where(eq(contact.organisationId, utilisateur.organisationId));
        return lignes.map((ligne) => this.versDto(ligne));
      }
    }
    const lignes = await this.db.select().from(contact);
    return lignes.map((ligne) => this.versDto(ligne));
  }

  async findById(id: string) {
    const [ligne] = await this.db.select().from(contact).where(eq(contact.id, id)).limit(1);
    return ligne ? this.versDto(ligne) : null;
  }

  async update(id: string, dto: UpdateContactDto) {
    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      contact,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Contact introuvable");
    }
    return this.versDto(ligne as ContactRow);
  }

  async archive(id: string) {
    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      contact,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Contact introuvable");
    }
    return this.versDto(ligne as ContactRow);
  }

  // Écran "Carnet de contacts" : agrège locataires + garants (lecture
  // seule, aucune modification possible depuis cet écran — ils gardent
  // leurs propres écrans de gestion existants) + contacts professionnels.
  // Chaque service source applique déjà son propre scoping par
  // organisation (LocatairesService/GarantsService/ContactsService
  // .findAll()) ; cette méthode ne fait qu'assembler leurs résultats,
  // jamais une deuxième logique de scoping.
  async findAllUnifie(): Promise<ContactUnifie[]> {
    const [locatairesActifs, garantsActifs, contactsActifs] = await Promise.all([
      this.locatairesService.findAll(),
      this.garantsService.findAll(),
      this.findAll()
    ]);

    const resultat: ContactUnifie[] = [];
    for (const l of locatairesActifs) {
      if (l.archivedAt !== null) {
        continue;
      }
      resultat.push({
        type: "locataire",
        id: l.id,
        nom: `${l.prenom} ${l.nom}`,
        telephone: l.telephone,
        email: l.email
      });
    }
    for (const g of garantsActifs) {
      if (g.archivedAt !== null) {
        continue;
      }
      resultat.push({
        type: "garant",
        id: g.id,
        nom: `${g.prenom} ${g.nom}`,
        telephone: g.telephone,
        email: g.email,
        bailId: g.bailId
      });
    }
    for (const c of contactsActifs) {
      if (c.archivedAt !== null) {
        continue;
      }
      resultat.push({
        type: c.role,
        id: c.id,
        nom: c.nom,
        telephone: c.telephone,
        email: c.email
      });
    }
    return resultat;
  }

  private versDto(ligne: ContactRow) {
    return {
      id: ligne.id,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt,
      updatedBy: ligne.updatedBy,
      version: ligne.version,
      archivedAt: ligne.archivedAt,
      nom: ligne.nom,
      typeEntite: ligne.typeEntite,
      role: ligne.role,
      telephone: ligne.telephone,
      email: ligne.email,
      notes: ligne.notes,
      organisationId: ligne.organisationId
    };
  }
}
