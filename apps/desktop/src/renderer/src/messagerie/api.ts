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
export type MessageClassificationType = "contact" | "locataire" | "candidat" | "garant" | "non_classe";
export type ClassificationTypeChoisie = "contact" | "locataire" | "candidat" | "garant";

export interface MessageCommunication {
  id: string;
  direction: MessageDirection;
  objet: string | null;
  // corpsHtml est déjà nettoyé côté backend (sanitize-html, à la
  // réception) — jamais du HTML brut. Nettoyé une seconde fois avec
  // DOMPurify juste avant le rendu (défense en profondeur, 2026-09-16),
  // jamais affiché tel quel sans cette deuxième passe.
  corpsTexte: string | null;
  corpsHtml: string | null;
  emailExpediteur: string;
  emailDestinataire: string;
  dateMessage: string;
  classificationType: MessageClassificationType;
  classificationId: string | null;
  organisationId: string;
  archivedAt: string | null;
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
  // Renseignés ensemble quand le destinataire est choisi depuis le Carnet
  // de contacts (sélecteur, 2026-09-16) : classification immédiate, sans
  // attendre une résolution a posteriori par adresse email — voir
  // ComposerMessageDto côté backend.
  classificationType?: ClassificationTypeChoisie;
  classificationId?: string;
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

// Archivage à l'unité du message (2026-09-17), jamais un fil entier — même
// principe que archiveContact/archiveCandidat. Ne touche jamais au vrai
// email sur Gmail, masque uniquement côté app.
export function archiverMessage(id: string): Promise<MessageCommunication> {
  return authenticatedFetch<MessageCommunication>(`/messagerie/messages/${id}/archiver`, { method: "PATCH" });
}
