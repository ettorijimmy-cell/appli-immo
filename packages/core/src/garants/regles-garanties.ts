// Règles d'acceptation des garanties d'un bail (chantier garants,
// décisions du 2026-11-08, tmp/decisions-garants.md). Fonctions pures :
// l'appelant (backend) fournit le contexte déjà lu en base. Elles bloquent
// la génération du bail et de l'acte, jamais la saisie d'un garant (à la
// saisie, les mêmes violations servent d'avertissements).

export type TypeGarantie = "personne_physique" | "garantie_visale" | "autre";

export type StatutEtudes = "non_renseigne" | "aucun" | "etudiant_boursier" | "etudiant_non_boursier" | "apprenti";

export interface GarantPourRegles {
  id: string;
  typeGarantie: TypeGarantie;
  // « Caution de » : locataire du bail garanti par cette caution, ou null.
  locataireId: string | null;
  numeroContratVisale: string | null;
}

export interface LocatairePourRegles {
  id: string;
  statutEtudes: StatutEtudes;
}

export type BailleurPourRegles = { type: "personne_physique" } | { type: "sci"; estFamiliale: boolean | null };

export interface ContexteGarantiesBail {
  assuranceLoyersImpayes: boolean;
  bailleur: BailleurPourRegles;
  // Locataires actuellement au bail (liens non archivés).
  locataires: readonly LocatairePourRegles[];
  // Garants non archivés, dans l'ordre d'impression (ordonnerGarantsDuBail).
  garants: readonly GarantPourRegles[];
}

export type CodeViolationGarantie =
  | "type_autre_refuse"
  | "visale_pas_seul_garant"
  | "visale_colocation"
  | "visale_numero_contrat_manquant"
  | "caution_sans_locataire_garanti"
  | "caution_interdite_assurance_loyers_impayes"
  | "caution_interdite_sci_non_familiale"
  | "sci_familiale_non_renseignee";

export interface ViolationGarantie {
  code: CodeViolationGarantie;
  // null pour une violation qui ne vise pas un garant précis.
  garantId: string | null;
  message: string;
}

export type SourceLocataireGaranti = "caution_de" | "locataire_unique";

export interface LocataireGaranti {
  locataireId: string;
  source: SourceLocataireGaranti;
}

/**
 * Locataire garanti par une caution :
 * - le locataire « Caution de » s'il est renseigné (même s'il a quitté le
 *   bail depuis : le lien est conservé, décision du 2026-11-08) ;
 * - sinon, le locataire unique d'un bail à un seul locataire ;
 * - sinon null (colocation sans « Caution de », ou bail sans locataire).
 */
export function resoudreLocataireGaranti(
  garant: { locataireId: string | null },
  locatairesDuBail: readonly { id: string }[]
): LocataireGaranti | null {
  if (garant.locataireId !== null) {
    return { locataireId: garant.locataireId, source: "caution_de" };
  }
  if (locatairesDuBail.length === 1) {
    return { locataireId: locatairesDuBail[0]!.id, source: "locataire_unique" };
  }
  return null;
}

const STATUTS_EXEMPTANT_ASSURANCE: readonly StatutEtudes[] = ["etudiant_boursier", "etudiant_non_boursier", "apprenti"];
const STATUTS_EXEMPTANT_SCI_NON_FAMILIALE: readonly StatutEtudes[] = ["etudiant_non_boursier"];

const INVITATION_STATUT_ETUDES =
  " Le statut d'études du locataire garanti n'est pas renseigné : à renseigner s'il est étudiant ou apprenti.";

function libelleGarant(index: number, total: number): string {
  return total > 1 ? `Garant ${index + 1}` : "Garant";
}

/**
 * Liste complète des violations, jamais seulement la première trouvée (même
 * discipline que validerCompletudeGenerationBail). Ordre : par garant, dans
 * l'ordre reçu, puis la violation commune « SCI familiale non renseignée ».
 */
export function verifierGarantiesBail(contexte: ContexteGarantiesBail): ViolationGarantie[] {
  const violations: ViolationGarantie[] = [];
  const total = contexte.garants.length;
  const nombreLocataires = contexte.locataires.length;
  const statutDe = (locataireId: string): StatutEtudes =>
    contexte.locataires.find((l) => l.id === locataireId)?.statutEtudes ?? "non_renseigne";
  let sciFamilialeASignaler = false;

  contexte.garants.forEach((garant, index) => {
    const label = libelleGarant(index, total);
    const ajouter = (code: CodeViolationGarantie, message: string): void => {
      violations.push({ code, garantId: garant.id, message: `${label} — ${message}` });
    };

    if (garant.typeGarantie === "autre") {
      ajouter("type_autre_refuse", "type « autre » non accepté : choisir caution personne physique ou garantie Visale");
      return;
    }

    if (garant.typeGarantie === "garantie_visale") {
      if (total > 1) {
        ajouter("visale_pas_seul_garant", "la garantie Visale doit être le seul garant du bail");
      }
      if (nombreLocataires > 1) {
        ajouter("visale_colocation", "garantie Visale impossible sur un bail à plusieurs locataires");
      }
      if (garant.numeroContratVisale === null || garant.numeroContratVisale.trim() === "") {
        ajouter("visale_numero_contrat_manquant", "numéro de contrat Visale");
      }
      return;
    }

    // Caution personne physique.
    const garanti = resoudreLocataireGaranti(garant, contexte.locataires);
    if (garanti === null && nombreLocataires > 1) {
      ajouter(
        "caution_sans_locataire_garanti",
        "colocation : préciser le locataire garanti (« Caution de »)"
      );
    }
    const statut: StatutEtudes = garanti === null ? "non_renseigne" : statutDe(garanti.locataireId);
    const invitation = statut === "non_renseigne" ? INVITATION_STATUT_ETUDES : "";

    if (contexte.assuranceLoyersImpayes && !STATUTS_EXEMPTANT_ASSURANCE.includes(statut)) {
      ajouter(
        "caution_interdite_assurance_loyers_impayes",
        `caution personne physique impossible : le bail est couvert par une assurance loyers impayés (sauf locataire garanti étudiant ou apprenti).${invitation}`
      );
    }

    if (contexte.bailleur.type === "sci") {
      if (contexte.bailleur.estFamiliale === null) {
        sciFamilialeASignaler = true;
      } else if (!contexte.bailleur.estFamiliale && !STATUTS_EXEMPTANT_SCI_NON_FAMILIALE.includes(statut)) {
        ajouter(
          "caution_interdite_sci_non_familiale",
          `caution personne physique impossible : le bailleur est une SCI non familiale (sauf locataire garanti étudiant non boursier).${invitation}`
        );
      }
    }
  });

  if (sciFamilialeASignaler) {
    violations.push({
      code: "sci_familiale_non_renseignee",
      garantId: null,
      message: "SCI familiale ou non : à renseigner pour vérifier la caution personne physique"
    });
  }

  return violations;
}
