import type { DestinataireEnvoi, ResultatEnvoi } from "../api/etats-des-lieux";
import { ApiError } from "../lib/authenticated-fetch";

export const INTERVALLE_PDF_MS = 3_000;
export const PLAFOND_ATTENTE_PDF_MS = 120_000;

export interface DestinataireDemande {
  locataireId: string;
  nomAffiche: string;
  email: string;
}

export interface LigneResultat {
  destinataire: DestinataireDemande;
  // null : destinataire demandé, mais sans résultat (demande interrompue).
  resultat: ResultatEnvoi | null;
}

// Vérification d'écran seulement : le backend revalide à l'envoi.
export function adresseEmailPlausible(adresse: string): boolean {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(adresse);
}

// crypto.randomUUID n'existe qu'en contexte sécurisé, pas sur le serveur de
// dev ouvert depuis un téléphone du réseau local. UUID v4 construit à la main.
export function genererDemandeId(): string {
  const octets = crypto.getRandomValues(new Uint8Array(16));
  octets[6] = ((octets[6] ?? 0) & 0x0f) | 0x40;
  octets[8] = ((octets[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...octets].map((o) => o.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Un envoi déjà accepté n'est jamais recoché d'office : renvoyer reste un
// choix explicite.
export function selectionInitiale(destinataires: DestinataireEnvoi[]): string[] {
  return destinataires
    .filter((d) => d.email && adresseEmailPlausible(d.email) && d.dernierEnvoi?.statut !== "envoye")
    .map((d) => d.locataireId);
}

export function lignesResultat(demandes: DestinataireDemande[], resultats: ResultatEnvoi[]): LigneResultat[] {
  return demandes.map((destinataire) => ({
    destinataire,
    resultat: resultats.find((r) => r.locataireId === destinataire.locataireId) ?? null
  }));
}

export function aRenvoyer(lignes: LigneResultat[]): string[] {
  return lignes
    .filter(({ resultat }) => !resultat || resultat.statut === "echec" || resultat.statut === "indetermine")
    .map(({ destinataire }) => destinataire.locataireId);
}

// Sans réponse exploitable, le mail a pu partir : seule la même demande peut
// être rejouée sans risque de doublon. Un refus 4xx, lui, n'a rien envoyé.
export function demandeARejouer(erreur: unknown): boolean {
  return !(erreur instanceof ApiError) || erreur.status >= 500;
}

export function formaterDateHeure(dateIso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Paris"
  }).format(new Date(dateIso));
}

export function libelleResultat(resultat: ResultatEnvoi | null): string {
  if (!resultat) {
    return "Aucun résultat : l'envoi a été interrompu avant ce destinataire.";
  }
  switch (resultat.statut) {
    case "envoye":
      return `Accepté par le serveur d'envoi le ${formaterDateHeure(resultat.envoyeLe ?? resultat.tenteLe)}.`;
    case "echec":
      return resultat.messageErreur ?? "L'envoi a échoué.";
    case "en_cours":
      return "Un envoi est déjà en cours pour ce destinataire.";
    case "indetermine":
      return "Résultat inconnu : le mail a pu partir. Vérifiez les messages envoyés de la boîte dédiée.";
  }
}
