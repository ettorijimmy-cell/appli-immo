import { Inject, Injectable } from "@nestjs/common";
import { comptesBancairesSci, type Database } from "db";
import { eq } from "drizzle-orm";
import { EncryptionService } from "../crypto/encryption.service";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateCompteBancaireDto } from "./dto/create-compte-bancaire.dto";

@Injectable()
export class ComptesBancairesSciService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly encryptionService: EncryptionService
  ) {}

  // Ne retourne jamais l'IBAN/BIC en clair : seule findBySciIdDecrypted le
  // fait, via l'endpoint dédié GET /scis/:id/comptes-bancaires.
  async create(dto: CreateCompteBancaireDto) {
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

  async findBySciIdDecrypted(sciId: string) {
    const comptes = await this.db
      .select()
      .from(comptesBancairesSci)
      .where(eq(comptesBancairesSci.sciId, sciId));

    return comptes.map((compte) => ({
      id: compte.id,
      sciId: compte.sciId,
      iban: this.encryptionService.decrypt(compte.ibanChiffre),
      bic: this.encryptionService.decrypt(compte.bicChiffre)
    }));
  }
}
