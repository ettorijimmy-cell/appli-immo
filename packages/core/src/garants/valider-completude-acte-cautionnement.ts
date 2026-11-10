// Données nécessaires pour générer l'acte de cautionnement d'une caution
// personne physique (chantier garants, décisions du 2026-11-08). Même
// discipline que validerCompletudeGenerationBail : la liste complète de ce
// qui manque, jamais seulement le premier trouvé, et un contrôle fait
// AVANT toute génération. Les règles d'acceptation (verifierGarantiesBail)
// s'y ajoutent, limitées à cette caution et aux violations communes.
import type { ChoixDureeBail } from "../baux/calculer-duree-bail";
import {
  resoudreLocataireGaranti,
  verifierGarantiesBail,
  type ContexteGarantiesBail,
  type TypeGarantie
} from "./regles-garanties";

export interface DonneesCompletudeActeCautionnement {
  // La caution concernée ; doit figurer dans garanties.garants.
  garantId: string;
  caution: {
    typeGarantie: TypeGarantie;
    nom: string | null;
    prenom: string | null;
    dateNaissance: string | null;
    lieuNaissance: string | null;
    nationalite: string | null;
    adresse: string | null;
    codePostal: string | null;
    ville: string | null;
  };
  // Identité des locataires que l'acte peut désigner : ceux du bail, plus
  // le locataire « Caution de » s'il a quitté le bail depuis.
  identitesLocataires: readonly { id: string; nom: string | null; prenom: string | null }[];
  bail: {
    loyerMensuel: string | null;
    // null compte pour 0 (même convention que calculerMontantEcheanceLoyer),
    // jamais signalé comme manquant.
    provisionsCharges: string | null;
    dateDebut: string | null;
    // null quand la durée légale ne peut pas être déterminée (SCI dont le
    // caractère familial n'est pas renseigné).
    choixDuree: ChoixDureeBail | null;
    // Conditions de révision du loyer, mention exigée dans l'acte (loi
    // n° 89-462, art. 22-1) : trimestre de référence de l'IRL (1 à 4) et
    // indice disponible (même contrôle que la génération du bail).
    trimestreReferenceRevision: number | null;
    irlIndisponible: boolean;
  };
  bailleur: { nom: string | null };
  garanties: ContexteGarantiesBail;
}

function vide(valeur: string | null): boolean {
  return valeur === null || valeur.trim() === "";
}

export function validerCompletudeActeCautionnement(donnees: DonneesCompletudeActeCautionnement): string[] {
  if (donnees.caution.typeGarantie !== "personne_physique") {
    return ["Acte de cautionnement réservé à une caution personne physique"];
  }

  const manquants: string[] = [];
  const champsCaution: [keyof DonneesCompletudeActeCautionnement["caution"], string][] = [
    ["nom", "nom"],
    ["prenom", "prénom"],
    ["dateNaissance", "date de naissance"],
    ["lieuNaissance", "lieu de naissance"],
    ["nationalite", "nationalité"],
    ["adresse", "adresse"],
    ["codePostal", "code postal"],
    ["ville", "ville"]
  ];
  for (const [champ, libelle] of champsCaution) {
    if (vide(donnees.caution[champ] as string | null)) {
      manquants.push(`Caution — ${libelle}`);
    }
  }

  // Locataire garanti. La colocation sans « Caution de » est signalée par
  // verifierGarantiesBail (caution_sans_locataire_garanti), pas ici.
  const garant = donnees.garanties.garants.find((g) => g.id === donnees.garantId);
  const garanti = garant ? resoudreLocataireGaranti(garant, donnees.garanties.locataires) : null;
  if (garanti === null) {
    if (donnees.garanties.locataires.length === 0) {
      manquants.push("Locataire garanti — aucun locataire au bail");
    }
  } else {
    const identite = donnees.identitesLocataires.find((l) => l.id === garanti.locataireId);
    if (!identite || vide(identite.nom) || vide(identite.prenom)) {
      manquants.push("Locataire garanti — nom et prénom");
    }
  }

  if (vide(donnees.bail.loyerMensuel)) {
    manquants.push("Loyer du bail");
  }
  if (vide(donnees.bail.dateDebut)) {
    manquants.push("Date d'effet du bail");
  }
  if (donnees.bail.choixDuree === null) {
    manquants.push("Durée du bail (SCI familiale ou non)");
  }
  if (donnees.bail.trimestreReferenceRevision === null) {
    manquants.push("Trimestre IRL de référence du bail");
  }
  if (donnees.bail.irlIndisponible) {
    // Libellé identique à celui de validerCompletudeGenerationBail.
    manquants.push("Indice de référence des loyers (IRL) — aucune valeur récente disponible");
  }
  if (vide(donnees.bailleur.nom)) {
    manquants.push("Bailleur — nom");
  }

  for (const violation of verifierGarantiesBail(donnees.garanties)) {
    if (violation.garantId === donnees.garantId || violation.garantId === null) {
      manquants.push(violation.message);
    }
  }

  return manquants;
}
