import { readFileSync } from "fs";
import path from "path";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";

// Vérifie directement, sur le texte brut des DEUX fichiers .docx (le modèle
// réel ET la fixture de test), que le commit A a bien été appliqué aux deux
// à l'identique — indépendamment de docxtemplater, puisque les passages
// concernés sont du texte littéral commun aux régimes vide et meublé.

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
])("chantier bail — corrections juridiques, commit A — %s", (_label, chemin) => {
  const texte = texteDuModele(chemin);

  it("A.2 : la mention de la taxe d'habitation (article 1686 du C.G.I.) est retirée", () => {
    expect(texte).not.toContain("taxe d’habitation");
    expect(texte).not.toContain("1686");
    expect(texte).toContain(
      "Ne pas déménager sans s’être conformé à ses obligations (paiement des loyers, des charges et des contributions diverses lui incombant personnellement, relevé des différents compteurs, exécution des réparations locatives, etc…)."
    );
  });

  it("A.4a : « handicapé ;, s'il » est corrigé en « handicapé ; s'il »", () => {
    expect(texte).not.toContain("handicapé ;, s’il");
    expect(texte).toContain("handicapé ; s’il");
  });

  it("A.4b : « concubin notoire). ; » est corrigé en « concubin notoire) ; »", () => {
    expect(texte).not.toContain("notoire). ;");
    expect(texte).toContain("concubin notoire) ;");
  });

  it("A.4c : « pendant deux premiers mois » est corrigé en « pendant les deux premiers mois »", () => {
    expect(texte).not.toContain("pendant deux premiers mois");
    expect(texte).toContain("pendant les deux premiers mois du délai de préavis");
  });
});
