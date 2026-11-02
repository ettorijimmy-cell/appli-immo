// Règles de remise partagées par le mobile et le desktop.
export type StatutEnvoiRemise = "en_cours" | "envoye" | "echec" | "indetermine";

export interface ResultatEnvoiRemise {
  locataireId: string;
  statut: StatutEnvoiRemise;
  tenteLe: string;
  envoyeLe: string | null;
  messageErreur: string | null;
}

export interface DestinataireRemise {
  locataireId: string;
  email: string | null;
  dernierEnvoi: ResultatEnvoiRemise | null;
}

export interface DestinataireDemande {
  locataireId: string;
  nomAffiche: string;
  email: string;
}

export interface LigneResultatRemise<R extends ResultatEnvoiRemise = ResultatEnvoiRemise> {
  destinataire: DestinataireDemande;
  // null : destinataire demandé, mais sans résultat (demande interrompue).
  resultat: R | null;
}

// Vérification d'écran seulement : le backend revalide à l'envoi.
export function adresseEmailPlausible(adresse: string): boolean {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(adresse);
}

// Octets aléatoires fournis par l'appelant : packages/core ne dépend ni de
// Node ni du navigateur.
export function construireDemandeId(octetsAleatoires: Uint8Array): string {
  const octets = [...octetsAleatoires];
  octets[6] = ((octets[6] ?? 0) & 0x0f) | 0x40;
  octets[8] = ((octets[8] ?? 0) & 0x3f) | 0x80;
  const hex = octets.map((o) => o.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Un envoi déjà accepté n'est jamais recoché d'office : renvoyer reste un
// choix explicite.
export function selectionInitialeRemise(destinataires: DestinataireRemise[]): string[] {
  return destinataires
    .filter((d) => d.email && adresseEmailPlausible(d.email) && d.dernierEnvoi?.statut !== "envoye")
    .map((d) => d.locataireId);
}

// Une confirmation doit dire aussi qui ne recevra rien : un colocataire décoché
// ou sans adresse ne doit jamais passer inaperçu au moment de la remise.
export function libellesNonDestinataires<D extends DestinataireRemise & { nomAffiche: string }>(
  signataires: D[],
  idsDestinataires: string[]
): string[] {
  return signataires
    .filter((s) => !idsDestinataires.includes(s.locataireId))
    .map((s) => {
      const dejaEnvoye = s.dernierEnvoi?.statut === "envoye" && s.dernierEnvoi.envoyeLe;
      return dejaEnvoye
        ? `${s.nomAffiche} : non destinataire (déjà envoyé le ${formaterDateHeureRemise(s.dernierEnvoi?.envoyeLe ?? "")})`
        : `${s.nomAffiche} : non destinataire`;
    });
}

export function lignesResultatRemise<R extends ResultatEnvoiRemise>(
  demandes: DestinataireDemande[],
  resultats: R[]
): LigneResultatRemise<R>[] {
  return demandes.map((destinataire) => ({
    destinataire,
    resultat: resultats.find((r) => r.locataireId === destinataire.locataireId) ?? null
  }));
}

export function destinatairesARenvoyer(lignes: LigneResultatRemise[]): string[] {
  return lignes
    .filter(({ resultat }) => !resultat || resultat.statut === "echec" || resultat.statut === "indetermine")
    .map(({ destinataire }) => destinataire.locataireId);
}

// Sans réponse exploitable, le mail a pu partir : seule la même demande peut
// être rejouée sans risque de doublon. Un refus 4xx, lui, n'a rien envoyé.
// statut undefined : aucune réponse HTTP (réseau coupé).
export function demandeARejouer(statut: number | undefined): boolean {
  return statut === undefined || statut >= 500;
}

export function formaterDateHeureRemise(dateIso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Paris"
  }).format(new Date(dateIso));
}

export function libelleResultatRemise(resultat: ResultatEnvoiRemise | null): string {
  if (!resultat) {
    return "Aucun résultat : l'envoi a été interrompu avant ce destinataire.";
  }
  switch (resultat.statut) {
    case "envoye":
      return `Accepté par le serveur d'envoi le ${formaterDateHeureRemise(resultat.envoyeLe ?? resultat.tenteLe)}.`;
    case "echec":
      return resultat.messageErreur ?? "L'envoi a échoué.";
    case "en_cours":
      return "Un envoi est déjà en cours pour ce destinataire.";
    case "indetermine":
      return "Résultat inconnu : le mail a pu partir. Vérifiez les messages envoyés de la boîte dédiée.";
  }
}
