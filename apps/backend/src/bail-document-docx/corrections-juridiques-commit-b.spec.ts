import { readFileSync } from "fs";
import path from "path";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";

// Vérifie directement, sur le texte brut des DEUX fichiers .docx (le modèle
// réel ET la fixture de test), que le commit B (B.1 à B.4) a bien été
// appliqué aux deux à l'identique — indépendamment de docxtemplater,
// puisque les passages concernés sont du texte littéral commun aux régimes
// vide et meublé. B.5 (reconduction) n'est volontairement pas touché par ce
// commit : voir bail-document-docx.integration.spec.ts, describe "durée du
// contrat et reconduction tacite (section III)", qui reste inchangé.

const MODELE_REEL = path.join(__dirname, "assets", "modele-bail.docx");
const MODELE_FIXTURE = path.join(__dirname, "__fixtures__", "modele-bail-test.docx");

function texteDuModele(cheminDocx: string): string {
  const zip = new PizZip(readFileSync(cheminDocx));
  const xml = zip.file("word/document.xml")!.asText();
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
}

describe.each([
  ["modèle réel (assets/modele-bail.docx)", MODELE_REEL],
  ["fixture de test (__fixtures__/modele-bail-test.docx)", MODELE_FIXTURE]
])("chantier bail — corrections juridiques, commit B — %s", (_label, chemin) => {
  const texte = texteDuModele(chemin);

  it("B.1 : le forfait ménage de 100 euros est remplacé par la clause de propreté", () => {
    expect(texte).not.toContain("100 euros");
    expect(texte).not.toContain("frais de ménage");
    expect(texte).toContain(
      "Le locataire devra restituer le logement dans un état de propreté conforme à celui constaté lors de l’entrée dans les lieux, compte tenu de la vétusté et de l’usure normale."
    );
    expect(texte).toContain("conformément à l’article 22 de la loi n° 89-462 du 6 juillet 1989.");
  });

  it("B.2 : l'indemnité d'occupation au double du loyer est remplacée", () => {
    expect(texte).not.toContain("double du loyer");
    expect(texte).toContain(
      "À compter de la cessation effective du bail, si le locataire se maintient dans les lieux sans droit ni titre, il sera redevable d’une indemnité d’occupation jusqu’à la libération effective des lieux et la restitution des clés."
    );
  });

  it("B.3 : les deux paragraphes « frais et manquements » sont fusionnés en un seul, et le titre de section est mis à jour", () => {
    expect(texte).not.toContain("Le coût des commandements");
    expect(texte).not.toContain("De plus, le BAILLEUR se réserve");
    expect(texte).not.toContain("CLAUSE RESOLUTOIRE ET CLAUSE PENALE");
    expect(texte).toContain("CLAUSE RESOLUTOIRE ET CONSEQUENCES DES MANQUEMENTS CONTRACTUELS");
    expect(texte).toContain(
      "En cas de manquement du locataire à ses obligations, le bailleur pourra solliciter l’exécution des obligations concernées et, le cas échéant, la réparation du préjudice effectivement subi, dans les conditions prévues par les textes applicables."
    );
  });

  it("B.4 : le congé est réécrit et la phrase de clause pénale est supprimée", () => {
    expect(texte).not.toContain("ne recourir à aucune formalité");
    expect(texte).not.toContain("clause pénale incluse");
    expect(texte).toContain(
      "Le congé est délivré par la partie qui en prend l’initiative dans les formes, délais et conditions prévus par la loi applicable au présent contrat."
    );
    expect(texte).toContain("acte de commissaire de justice");
  });

  it("B.5 : la reconduction tacite n'est pas modifiée par ce commit", () => {
    expect(texte).toContain("renouvelable ensuite par tacite reconduction et par périodes de");
  });
});
