import type { Content } from "pdfmake/interfaces";
import type { DonneesSectionIV } from "../types";

/**
 * Section IV ("Conditions financières"). Mentions du contrat-type : loyer,
 * charges, loyer du précédent locataire (si départ < 18 mois, calculé —
 * jamais saisi, voir calculerLoyerPrecedentLocataire), dépenses théoriques
 * de chauffage (issues du DPE, section II).
 */
export function construireSectionIV(donnees: DonneesSectionIV): Content {
  const lignes: string[] = [
    `Loyer mensuel hors charges : ${donnees.loyerMensuel ?? "[à renseigner]"} €`,
    `Provisions mensuelles pour charges : ${donnees.provisionsCharges ?? "0.00"} €`
  ];

  if (donnees.loyerPrecedentLocataire) {
    lignes.push(
      `Montant du loyer acquitté par le précédent locataire (départ de moins de dix-huit mois) : ${donnees.loyerPrecedentLocataire} €`
    );
  }

  if (donnees.depensesTheoriquesChauffage) {
    lignes.push(
      `Estimation des dépenses théoriques de chauffage (issue du diagnostic de performance énergétique) : ${donnees.depensesTheoriquesChauffage} €/an`
    );
  }

  return [
    { text: "IV. Conditions financières", style: "titreSection" },
    { ul: lignes, margin: [0, 4, 0, 8] }
  ];
}
