import { authenticatedFetch } from "../lib/authenticated-fetch";

export type ContactTypeEntite = "personne_physique" | "entreprise";
export type ContactRole = "artisan" | "diagnostiqueur" | "syndic" | "assureur" | "autre";

export const CONTACT_ROLES: ContactRole[] = ["artisan", "diagnostiqueur", "syndic", "assureur", "autre"];

export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  artisan: "Artisan",
  diagnostiqueur: "Diagnostiqueur",
  syndic: "Syndic",
  assureur: "Assureur",
  autre: "Autre"
};

export interface Contact {
  id: string;
  nom: string;
  typeEntite: ContactTypeEntite;
  role: ContactRole;
  telephone: string | null;
  email: string | null;
  notes: string | null;
  archivedAt: string | null;
}

export interface CreateContactInput {
  nom: string;
  typeEntite: ContactTypeEntite;
  role: ContactRole;
  telephone?: string;
  email?: string;
  notes?: string;
}

export interface UpdateContactInput {
  nom?: string;
  typeEntite?: ContactTypeEntite;
  role?: ContactRole;
  telephone?: string;
  email?: string;
  notes?: string;
}

// Carnet de contacts (Module Carnet de contacts, 2026-09-13) : chaque
// ligne porte au minimum un type discriminant ("locataire"/"garant"/le
// rôle du contact pro), un nom, un téléphone et un email — locataires et
// garants restent en lecture seule ici (aucune modification depuis cet
// écran, ils gardent leurs propres écrans de gestion). bailId n'est
// renseigné que pour type === "garant" (navigation vers l'onglet Bail de
// l'appartement, aucune fiche autonome pour un garant).
export interface ContactUnifie {
  type: "locataire" | "garant" | ContactRole;
  id: string;
  nom: string;
  telephone: string | null;
  email: string | null;
  bailId?: string;
}

export function listContactsUnifies(): Promise<ContactUnifie[]> {
  return authenticatedFetch<ContactUnifie[]>("/contacts/unifie");
}

export function listContacts(): Promise<Contact[]> {
  return authenticatedFetch<Contact[]>("/contacts");
}

export function getContact(id: string): Promise<Contact> {
  return authenticatedFetch<Contact>(`/contacts/${id}`);
}

export function createContact(input: CreateContactInput): Promise<Contact> {
  return authenticatedFetch<Contact>("/contacts", { method: "POST", body: JSON.stringify(input) });
}

export function updateContact(id: string, input: UpdateContactInput): Promise<Contact> {
  return authenticatedFetch<Contact>(`/contacts/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function archiveContact(id: string): Promise<Contact> {
  return authenticatedFetch<Contact>(`/contacts/${id}/archiver`, { method: "PATCH" });
}
