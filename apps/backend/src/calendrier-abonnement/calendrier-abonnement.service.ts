import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { calendrierAbonnement, mettreAJourAvecAudit, type Database } from "db";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";

type CalendrierAbonnementRow = typeof calendrierAbonnement.$inferSelect;

// Jeton non listé traité comme un secret (voir packages/db/src/schema/
// calendrier-abonnement.ts) — l'URL d'abonnement ICS est la seule barrière
// (le flux est @Public(), voir CalendrierIcsController), 256 bits, même
// génération que les IV de EncryptionService (crypto.randomBytes).
const LONGUEUR_JETON_OCTETS = 32;

@Injectable()
export class CalendrierAbonnementService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService
  ) {}

  async trouverParOrganisation(organisationId: string) {
    const [ligne] = await this.db
      .select()
      .from(calendrierAbonnement)
      .where(eq(calendrierAbonnement.organisationId, organisationId))
      .limit(1);
    return ligne ? this.versDto(ligne) : null;
  }

  // Renvoie l'abonnement de l'organisation de l'utilisateur, ou null s'il
  // n'a jamais été généré — utilisé par Paramètres pour afficher soit
  // l'URL existante, soit une invite à en générer une.
  async obtenirPourUtilisateur(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    return this.trouverParOrganisation(user.organisationId);
  }

  // Génère un nouveau jeton — révoque implicitement l'ancienne URL
  // (mettreAJourAvecAudit remplace la valeur, jamais de suppression
  // physique, jamais deux lignes actives pour la même organisation grâce à
  // l'index unique organisationId).
  async genererOuRegenererJeton(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    const nouveauJeton = randomBytes(LONGUEUR_JETON_OCTETS).toString("hex");

    const existant = await this.trouverParOrganisation(user.organisationId);
    if (existant) {
      const [ligne] = await mettreAJourAvecAudit(
        this.db,
        calendrierAbonnement,
        existant.id,
        { jeton: nouveauJeton },
        this.requestContext.getUtilisateurId()
      );
      if (!ligne) {
        throw new Error("Échec de la régénération du jeton d'abonnement");
      }
      return this.versDto(ligne as CalendrierAbonnementRow);
    }

    const [ligne] = await this.db
      .insert(calendrierAbonnement)
      .values({ jeton: nouveauJeton, organisationId: user.organisationId })
      .returning();
    if (!ligne) {
      throw new Error("Échec de la création du jeton d'abonnement");
    }
    return this.versDto(ligne);
  }

  // Résolution jeton -> organisationId pour le flux ICS public
  // (CalendrierIcsController) — jamais d'information distinguant "jeton
  // mal formé" de "jeton inexistant" au niveau appelant, l'un et l'autre
  // renvoient null ici.
  async trouverOrganisationParJeton(jeton: string): Promise<string | null> {
    const [ligne] = await this.db
      .select({ organisationId: calendrierAbonnement.organisationId })
      .from(calendrierAbonnement)
      .where(eq(calendrierAbonnement.jeton, jeton))
      .limit(1);
    return ligne?.organisationId ?? null;
  }

  private versDto(ligne: CalendrierAbonnementRow) {
    return {
      id: ligne.id,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt,
      updatedBy: ligne.updatedBy,
      version: ligne.version,
      archivedAt: ligne.archivedAt,
      jeton: ligne.jeton,
      organisationId: ligne.organisationId
    };
  }
}
