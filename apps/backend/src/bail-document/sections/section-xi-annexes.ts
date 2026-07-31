import type { Content } from "pdfmake/interfaces";
import type { DiagnosticAnnexe, DonneesSectionXI } from "../types";

const LIBELLE_CATEGORIE: Record<DiagnosticAnnexe["categorie"], string> = {
  dpe: "Diagnostic de performance énergétique (DPE)",
  crep_plomb: "Constat de risque d'exposition au plomb (CREP)",
  erp: "État des risques et pollutions (ERP)",
  elec_gaz: "État des installations intérieures d'électricité et de gaz"
};

function ligneDiagnostic(diagnostic: DiagnosticAnnexe): string {
  const libelle = LIBELLE_CATEGORIE[diagnostic.categorie];
  if (!diagnostic.present) {
    return `${libelle} : absent — [à joindre avant signature]`;
  }
  return diagnostic.dateExpiration
    ? `${libelle} : joint (valide jusqu'au ${diagnostic.dateExpiration})`
    : `${libelle} : joint`;
}

/**
 * Section XI ("Annexes") — dossier diagnostique (DPE/CREP/ERP/élec-gaz),
 * notice d'information (document statique fixe, toujours identique),
 * état des lieux d'entrée et attestation d'assurance (rattachés comme
 * `documents`, Module 4). Pour un bail meublé, l'inventaire de mobilier
 * n'est mentionné que par son existence — son détail (liste légale de 11
 * postes, décret n° 2015-981) est différé au futur module État des lieux
 * (docs/backlog.md, section "Édition d'un bail").
 */
export function construireSectionXI(donnees: DonneesSectionXI): Content {
  const lignes = donnees.diagnostics.map(ligneDiagnostic);
  lignes.push("Notice d'information relative aux droits et obligations des locataires et des bailleurs : jointe.");
  lignes.push(
    donnees.etatDesLieuxEntreePresent
      ? "État des lieux d'entrée : joint."
      : "État des lieux d'entrée : absent — [à joindre avant signature]"
  );
  lignes.push(
    donnees.attestationAssurancePresente
      ? "Attestation d'assurance des risques locatifs du locataire : jointe."
      : "Attestation d'assurance des risques locatifs du locataire : absente — [à joindre avant signature]"
  );

  if (donnees.typeBail === "meuble") {
    lignes.push("Un inventaire de mobilier est annexé au présent contrat.");
  }

  return [
    { text: "XI. Annexes", style: "titreSection" },
    { ul: lignes, margin: [0, 4, 0, 8] }
  ];
}
