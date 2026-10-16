import { readFileSync } from "fs";
import path from "path";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";

// Vérifie directement, sur le texte brut des DEUX fichiers .docx (le modèle
// réel ET la fixture de test), que le commit C (représentant de la SCI)
// insère bien un paragraphe entièrement enveloppé par
// {#representantSci}...{/representantSci}, juste après l'identification de
// la SCI dans l'en-tête LE BAILLEUR.

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
])("chantier bail — corrections juridiques, commit C — %s", (_label, chemin) => {
  const texte = texteDuModele(chemin);

  it("insère la mention du représentant, enveloppée par {#representantSci}...{/representantSci}", () => {
    expect(texte).toContain(
      "{#representantSci}représentée par {prénom nom du gérant}, agissant en qualité de gérant, dûment habilité aux fins des présentes{/representantSci}"
    );
  });

  it("n'ajoute ni capital ni RCS ni SIREN (hors scope de ce commit)", () => {
    expect(texte).not.toContain("capital");
    expect(texte).not.toContain("RCS");
    expect(texte).not.toContain("SIREN");
  });
});
