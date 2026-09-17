import { authenticatedFetch } from "../lib/authenticated-fetch";
import type { DocumentCategorie, DocumentEntiteType } from "../documents/api";

export interface StatutBoiteMailDediee {
  configuree: boolean;
  email: string | null;
}

export interface ConfigurerBoiteMailDedieeInput {
  email: string;
  motDePasseApp: string;
}

export function obtenirStatutBoiteMailDediee(): Promise<StatutBoiteMailDediee> {
  return authenticatedFetch<StatutBoiteMailDediee>("/messagerie/boite-mail/statut");
}

export function configurerBoiteMailDediee(input: ConfigurerBoiteMailDedieeInput): Promise<StatutBoiteMailDediee> {
  return authenticatedFetch<StatutBoiteMailDediee>("/messagerie/boite-mail", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export type MessageDirection = "envoye" | "recu";
export type MessageClassificationType = "contact" | "locataire" | "candidat" | "non_classe";

export interface MessageCommunication {
  id: string;
  direction: MessageDirection;
  objet: string | null;
  corps: string | null;
  emailExpediteur: string;
  emailDestinataire: string;
  dateMessage: string;
  classificationType: MessageClassificationType;
  classificationId: string | null;
  organisationId: string;
}

export interface PieceJointeMessage {
  id: string;
  messageId: string;
  nomFichier: string;
  typeMime: string | null;
}

export interface MessageCommunicationDetail extends MessageCommunication {
  piecesJointes: PieceJointeMessage[];
}

export function listMessages(
  filtres: { classificationType?: MessageClassificationType; classificationId?: string } = {}
): Promise<MessageCommunication[]> {
  const params = new URLSearchParams();
  if (filtres.classificationType) params.set("classificationType", filtres.classificationType);
  if (filtres.classificationId) params.set("classificationId", filtres.classificationId);
  const query = params.toString();
  return authenticatedFetch<MessageCommunication[]>(`/messagerie/messages${query ? `?${query}` : ""}`);
}

export function getMessage(id: string): Promise<MessageCommunicationDetail> {
  return authenticatedFetch<MessageCommunicationDetail>(`/messagerie/messages/${id}`);
}

export interface ComposerMessageInput {
  destinataire: string;
  objet: string;
  corps: string;
}

export function composerMessage(input: ComposerMessageInput): Promise<MessageCommunicationDetail> {
  return authenticatedFetch<MessageCommunicationDetail>("/messagerie/messages/composer", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export interface ClasserPieceJointeInput {
  entiteType: DocumentEntiteType;
  entiteId: string;
  categorie: DocumentCategorie;
  dateExpiration?: string;
}

export function classerPieceJointeDansDocuments(pieceJointeId: string, input: ClasserPieceJointeInput): Promise<unknown> {
  return authenticatedFetch(`/messagerie/pieces-jointes/${pieceJointeId}/classer-dans-documents`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// Déclenchement manuel du job périodique (même code que le @Cron réel) —
// même principe que executerJobAlertes/executerJobTaches.
export function executerJobSyncMessagerie(): Promise<number> {
  return authenticatedFetch<number>("/messagerie/executer-job-sync", { method: "POST" });
}
