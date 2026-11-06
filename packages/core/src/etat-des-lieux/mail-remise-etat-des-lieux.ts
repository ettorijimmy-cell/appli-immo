export type PhaseMailRemise = "entree" | "sortie";

export interface DonneesMailRemise {
  phase: PhaseMailRemise;
  adresseLogement: string;
  codePostalLogement: string;
  villeLogement: string;
  // Date de signature de la phase, au format AAAA-MM-JJ.
  dateSignature: string;
  lieuSignature: string;
  nomBailleur: string;
  // Sortie après une entrée établie sur papier : le scan de l'entrée est
  // joint au même mail (décision 7).
  scanEntreePapierJoint?: boolean;
}

export interface MailRemise {
  objet: string;
  corps: string;
}

const LIBELLE_PHASE: Record<PhaseMailRemise, string> = { entree: "d'entrée", sortie: "de sortie" };

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre"
];

function formaterDateLongue(dateIso: string): string {
  const [annee, mois, jour] = dateIso.split("-").map(Number);
  const libelleMois = mois ? MOIS[mois - 1] : undefined;
  if (!annee || !libelleMois || !jour) {
    throw new Error(`Date de signature invalide : ${dateIso}`);
  }
  return `${jour === 1 ? "1er" : jour} ${libelleMois} ${annee}`;
}

// Sobre et factuel, sans aucune affirmation juridique : le mail indique ce
// qui est joint, le document fait foi. Texte identique pour chaque
// destinataire, chacun recevant son propre mail.
export function construireMailRemiseEtatDesLieux(donnees: DonneesMailRemise): MailRemise {
  const adresse = `${donnees.adresseLogement}, ${donnees.codePostalLogement} ${donnees.villeLogement}`;
  const phase = LIBELLE_PHASE[donnees.phase];
  return {
    objet: `État des lieux ${phase} — ${adresse}`,
    corps: [
      "Bonjour,",
      "",
      `Vous trouverez ci-joint l'état des lieux ${phase} du logement situé ${adresse}, signé le ${formaterDateLongue(donnees.dateSignature)} à ${donnees.lieuSignature}.`,
      ...(donnees.scanEntreePapierJoint
        ? ["", "Vous trouverez également ci-joint la copie numérisée de l'état des lieux d'entrée, établi et signé sur papier."]
        : []),
      "",
      "Cordialement,",
      donnees.nomBailleur
    ].join("\n")
  };
}
