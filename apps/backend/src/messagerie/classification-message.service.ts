import { Inject, Injectable } from "@nestjs/common";
import { candidat, contact, garants, locataires, type Database } from "db";
import { resoudreClassificationEmail, type ResultatClassification } from "core";
import { and, eq } from "drizzle-orm";
import { DATABASE_CONNECTION } from "../database/database.module";

/**
 * Résout la classification d'un message par correspondance EXACTE
 * d'adresse email contre contact.email/locataires.email/candidat.email/
 * garants.email, scopée à l'organisation courante — la décision (une
 * correspondance -> classée, zéro ou plusieurs -> non_classe) est déléguée
 * à resoudreClassificationEmail (packages/core, fonction pure). Utilisé à
 * la fois par ImapSyncJobService (messages reçus) et SmtpEnvoiService
 * (messages envoyés, classés dès l'envoi sur l'adresse destinataire) —
 * garants ajouté après coup (sélecteur de destinataire depuis le Carnet de
 * contacts, 2026-09-16) pour que la réponse d'un garant se classe dans le
 * même fil que le message qui lui a été envoyé, jamais un fil scindé.
 */
@Injectable()
export class ClassificationMessageService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async resoudre(email: string, organisationId: string): Promise<ResultatClassification> {
    const [contactsCorrespondants, locatairesCorrespondants, candidatsCorrespondants, garantsCorrespondants] =
      await Promise.all([
        this.db
          .select({ id: contact.id })
          .from(contact)
          .where(and(eq(contact.email, email), eq(contact.organisationId, organisationId))),
        this.db
          .select({ id: locataires.id })
          .from(locataires)
          .where(and(eq(locataires.email, email), eq(locataires.organisationId, organisationId))),
        this.db
          .select({ id: candidat.id })
          .from(candidat)
          .where(and(eq(candidat.email, email), eq(candidat.organisationId, organisationId))),
        this.db
          .select({ id: garants.id })
          .from(garants)
          .where(and(eq(garants.email, email), eq(garants.organisationId, organisationId)))
      ]);

    const correspondances = [
      ...contactsCorrespondants.map((c) => ({ type: "contact" as const, id: c.id })),
      ...locatairesCorrespondants.map((l) => ({ type: "locataire" as const, id: l.id })),
      ...candidatsCorrespondants.map((c) => ({ type: "candidat" as const, id: c.id })),
      ...garantsCorrespondants.map((g) => ({ type: "garant" as const, id: g.id }))
    ];

    return resoudreClassificationEmail(correspondances);
  }
}
