import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { comptesBancairesSci, organisationSci, type Database } from "db";
import { and, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service";
import { RequestContextService } from "../common/request-context";
import { EncryptionService } from "../crypto/encryption.service";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateCompteBancaireDto } from "./dto/create-compte-bancaire.dto";

@Injectable()
export class ComptesBancairesSciService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService
  ) {}

  // Ne retourne jamais l'IBAN/BIC en clair : seule findBySciIdDecrypted le
  // fait, via l'endpoint dédié GET /scis/:id/comptes-bancaires.
  async create(dto: CreateCompteBancaireDto) {
    await this.verifierAppartenanceSci(dto.sciId);

    const [compte] = await this.db
      .insert(comptesBancairesSci)
      .values({
        sciId: dto.sciId,
        ibanChiffre: this.encryptionService.encrypt(dto.iban),
        bicChiffre: this.encryptionService.encrypt(dto.bic)
      })
      .returning();
    if (!compte) {
      throw new Error("Échec de la création du compte bancaire");
    }
    return { id: compte.id, sciId: compte.sciId };
  }

  // Seul point de déchiffrement de l'IBAN/BIC — chaque appel consigne un
  // accès à un document sensible dans journal_audit (CLAUDE.md). Le
  // contrôle d'appartenance doit rester avant le déchiffrement ET avant la
  // journalisation : une SCI d'une autre organisation ne doit produire ni
  // IBAN en clair, ni ligne d'audit (voir commit "B6").
  async findBySciIdDecrypted(sciId: string, utilisateurId: string) {
    await this.verifierAppartenanceSci(sciId);

    const comptes = await this.db
      .select()
      .from(comptesBancairesSci)
      .where(eq(comptesBancairesSci.sciId, sciId));

    if (comptes.length > 0) {
      await this.auditService.logAccesDocumentSensible({ entiteId: sciId, utilisateurId });
    }

    return comptes.map((compte) => ({
      id: compte.id,
      sciId: compte.sciId,
      iban: this.encryptionService.decrypt(compte.ibanChiffre),
      bic: this.encryptionService.decrypt(compte.bicChiffre)
    }));
  }

  // scis n'a pas de colonne organisationId directe : le rattachement passe
  // par organisation_sci (même chemin que ScisService.findAll). Renvoie
  // toujours NotFoundException (jamais 403), y compris quand la SCI
  // n'existe pas du tout — pour ne jamais révéler l'existence d'une SCI
  // d'une autre organisation (principe acté au Sous-commit 4d). Comme dans
  // le reste du chantier, absence d'organisationId (script/test hors
  // contexte HTTP) laisse passer sans contrôle.
  private async verifierAppartenanceSci(sciId: string): Promise<void> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      return;
    }
    const [rattachement] = await this.db
      .select({ sciId: organisationSci.sciId })
      .from(organisationSci)
      .where(and(eq(organisationSci.sciId, sciId), eq(organisationSci.organisationId, organisationId)))
      .limit(1);
    if (!rattachement) {
      throw new NotFoundException("SCI introuvable");
    }
  }
}
