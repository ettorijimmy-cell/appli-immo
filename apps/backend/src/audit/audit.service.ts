import { Inject, Injectable } from "@nestjs/common";
import { journalAudit, type Database } from "db";
import { DATABASE_CONNECTION } from "../database/database.module";

export interface LogAccesDocumentSensibleInput {
  entiteId: string;
  utilisateurId: string;
}

export interface LogAccesDonneeSensibleInput {
  entiteType: string;
  entiteId: string;
  utilisateurId: string;
}

/**
 * Écrit dans journal_audit (table transverse, append-only — voir
 * docs/data-dictionary.md). Point d'entrée commun pour tout futur module
 * ayant besoin de tracer un accès à une donnée sensible, pas seulement
 * comptes-bancaires-sci.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async logAccesDonneeSensible(input: LogAccesDonneeSensibleInput): Promise<void> {
    await this.db.insert(journalAudit).values({
      entiteType: input.entiteType,
      entiteId: input.entiteId,
      action: "acces",
      utilisateurId: input.utilisateurId
    });
  }

  async logAccesDocumentSensible(input: LogAccesDocumentSensibleInput): Promise<void> {
    await this.logAccesDonneeSensible({ ...input, entiteType: "document_sensible" });
  }
}
