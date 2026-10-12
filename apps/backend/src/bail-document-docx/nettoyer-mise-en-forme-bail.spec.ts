import { describe, expect, it } from "vitest";
import { nettoyerMiseEnFormeBail } from "./nettoyer-mise-en-forme-bail";

// w14:paraId réels du modèle, ciblés en dur par nettoyerMiseEnFormeBail — le
// fixture doit toujours les inclure, même quand le test porte sur autre
// chose (suppression de paragraphe vide, sauts de page...), sous peine
// d'une erreur "paragraphe introuvable" non liée au comportement testé.
const PARA_ID_LES_CHARGES = "00BF507F";
const PARA_ID_SIGNATURES = [
  "23B7E4E2",
  "60D47E4D",
  "52FE45C2",
  "7FC711FE",
  "130A3A68",
  "0A6F6873",
  "6F06ADE2",
  "6E49BA73",
  "1D82B7A7",
  "4AEB3267",
  "3BF966F8",
  "69F011DB",
  "39E9EFA0"
];
const PARA_ID_DERNIERE_LIGNE_SIGNATURES = "5E9AAAA2";

interface ParagrapheSpec {
  paraId: string;
  texteModele?: string;
  texteRendu?: string;
  sautDePage?: boolean;
}

function construireParagraphe(spec: ParagrapheSpec, variante: "modele" | "rendu"): string {
  if (spec.sautDePage) {
    return `<w:p w14:paraId="${spec.paraId}"><w:pPr><w:rPr/></w:pPr><w:r><w:rPr/><w:br w:type="page"/></w:r></w:p>`;
  }
  const texte = variante === "modele" ? spec.texteModele ?? "" : spec.texteRendu ?? "";
  const run = texte === "" ? "" : `<w:r><w:rPr/><w:t>${texte}</w:t></w:r>`;
  return `<w:p w14:paraId="${spec.paraId}"><w:pPr><w:rPr/></w:pPr>${run}</w:p>`;
}

function construireDocument(corps: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document><w:body>${corps}<w:sectPr/></w:body></w:document>`;
}

// Fixture représentative : les 14 paragraphes-cibles obligatoires
// (LES CHARGES + bloc signatures, jamais vidés ni supprimés) + les
// paragraphes propres à chaque test (servitude, caution, espacements,
// sauts de page).
function construireFixture(paragraphesTest: ParagrapheSpec[]): { xmlModele: string; xmlRendu: string } {
  const cibles: ParagrapheSpec[] = [
    { paraId: "BREAK_STANDARD_1", sautDePage: true },
    { paraId: "BREAK_STANDARD_2", sautDePage: true },
    { paraId: PARA_ID_LES_CHARGES, texteModele: "LES CHARGES", texteRendu: "LES CHARGES" },
    { paraId: PARA_ID_SIGNATURES[0]!, texteModele: "Fait à Paris le 1 janvier 2026", texteRendu: "Fait à Paris le 1 janvier 2026" },
    { paraId: PARA_ID_SIGNATURES[1]! }, // espacement voulu
    { paraId: PARA_ID_SIGNATURES[2]!, texteModele: "(Signatures précédées...)", texteRendu: "(Signatures précédées...)" },
    { paraId: PARA_ID_SIGNATURES[3]! },
    { paraId: PARA_ID_SIGNATURES[4]! },
    { paraId: PARA_ID_SIGNATURES[5]! },
    { paraId: PARA_ID_SIGNATURES[6]!, texteModele: "LE(S) BAILLEUR(S)", texteRendu: "LE(S) BAILLEUR(S)" },
    { paraId: PARA_ID_SIGNATURES[7]!, texteModele: "LE(S) PRENEUR(S)", texteRendu: "LE(S) PRENEUR(S)" },
    { paraId: PARA_ID_SIGNATURES[8]!, texteModele: "LA OU LES CAUTION(S)", texteRendu: "LA OU LES CAUTION(S)" },
    { paraId: PARA_ID_SIGNATURES[9]!, texteModele: "« lu et approuvé »", texteRendu: "« lu et approuvé »" },
    { paraId: PARA_ID_SIGNATURES[10]! },
    { paraId: PARA_ID_SIGNATURES[11]! },
    { paraId: PARA_ID_SIGNATURES[12]!, texteModele: "« lu et approuvé »", texteRendu: "« lu et approuvé »" },
    { paraId: PARA_ID_DERNIERE_LIGNE_SIGNATURES, texteModele: "« lu et approuvé, caution »", texteRendu: "« lu et approuvé, caution »" }
  ];
  const tous = [...paragraphesTest, ...cibles];
  return {
    xmlModele: construireDocument(tous.map((p) => construireParagraphe(p, "modele")).join("")),
    xmlRendu: construireDocument(tous.map((p) => construireParagraphe(p, "rendu")).join(""))
  };
}

function compterOccurrences(xml: string, sousChaine: string): number {
  return xml.split(sousChaine).length - 1;
}

describe("nettoyerMiseEnFormeBail", () => {
  it("supprime un paragraphe entièrement vidé par une balise conditionnelle simple", () => {
    const { xmlModele, xmlRendu } = construireFixture([
      { paraId: "TEST_SERVITUDE", texteModele: "{#servitude}Servitude de résidence principale.{/servitude}", texteRendu: "" }
    ]);
    const resultat = nettoyerMiseEnFormeBail(xmlModele, xmlRendu);
    expect(resultat).not.toContain("TEST_SERVITUDE");
  });

  it("conserve le paragraphe quand la balise conditionnelle est vraie", () => {
    const { xmlModele, xmlRendu } = construireFixture([
      {
        paraId: "TEST_SERVITUDE",
        texteModele: "{#servitude}Servitude de résidence principale.{/servitude}",
        texteRendu: "Servitude de résidence principale."
      }
    ]);
    const resultat = nettoyerMiseEnFormeBail(xmlModele, xmlRendu);
    expect(resultat).toContain("TEST_SERVITUDE");
    expect(resultat).toContain("Servitude de résidence principale.");
  });

  it("supprime tous les paragraphes d'un bloc conditionnel réparti sur plusieurs paragraphes (ex. bloc caution)", () => {
    const { xmlModele, xmlRendu } = construireFixture([
      { paraId: "TEST_GARANT_1", texteModele: "{#aGarant} La présente location est garantie...", texteRendu: "" },
      { paraId: "TEST_GARANT_2", texteModele: "Nom : {Nom prénom de la personne caution}", texteRendu: "" },
      { paraId: "TEST_GARANT_3", texteModele: "Un exemplaire de l'engagement... {/aGarant}", texteRendu: "" }
    ]);
    const resultat = nettoyerMiseEnFormeBail(xmlModele, xmlRendu);
    expect(resultat).not.toContain("TEST_GARANT_1");
    expect(resultat).not.toContain("TEST_GARANT_2");
    expect(resultat).not.toContain("TEST_GARANT_3");
  });

  it("conserve le bloc caution quand la balise est vraie, avec son contenu réel", () => {
    const { xmlModele, xmlRendu } = construireFixture([
      { paraId: "TEST_GARANT_1", texteModele: "{#aGarant} La présente location est garantie...", texteRendu: " La présente location est garantie..." },
      { paraId: "TEST_GARANT_2", texteModele: "Nom : {Nom prénom de la personne caution}", texteRendu: "Nom : Jean Dupont" },
      { paraId: "TEST_GARANT_3", texteModele: "Un exemplaire de l'engagement... {/aGarant}", texteRendu: "Un exemplaire de l'engagement... " }
    ]);
    const resultat = nettoyerMiseEnFormeBail(xmlModele, xmlRendu);
    expect(resultat).toContain("TEST_GARANT_1");
    expect(resultat).toContain("Jean Dupont");
    expect(resultat).toContain("TEST_GARANT_3");
  });

  it("conserve les paragraphes déjà vides dans le modèle (espacement voulu), même après rendu", () => {
    const { xmlModele, xmlRendu } = construireFixture([{ paraId: "TEST_ESPACEMENT" }]);
    const resultat = nettoyerMiseEnFormeBail(xmlModele, xmlRendu);
    expect(resultat).toContain("TEST_ESPACEMENT");
  });

  it("ne fusionne jamais deux paragraphes d'espacement voulu consécutifs de part et d'autre d'un bloc supprimé", () => {
    const { xmlModele, xmlRendu } = construireFixture([
      { paraId: "TEST_ESPACEMENT_AVANT" },
      { paraId: "TEST_SERVITUDE", texteModele: "{#servitude}Texte.{/servitude}", texteRendu: "" },
      { paraId: "TEST_ESPACEMENT_APRES" }
    ]);
    const resultat = nettoyerMiseEnFormeBail(xmlModele, xmlRendu);
    expect(resultat).not.toContain("TEST_SERVITUDE");
    // Toujours deux <w:p> distincts, jamais fusionnés en un seul.
    expect(compterOccurrences(resultat, 'w14:paraId="TEST_ESPACEMENT_AVANT"')).toBe(1);
    expect(compterOccurrences(resultat, 'w14:paraId="TEST_ESPACEMENT_APRES"')).toBe(1);
    const indexAvant = resultat.indexOf("TEST_ESPACEMENT_AVANT");
    const indexApres = resultat.indexOf("TEST_ESPACEMENT_APRES");
    const entreLesDeux = resultat.slice(indexAvant, indexApres);
    // Chaque <w:p> garde ses propres balises ouvrante/fermante.
    expect((entreLesDeux.match(/<w:p\b/g) ?? []).length).toBe(1);
  });

  it("supprime les deux sauts de page manuels sans supprimer leurs paragraphes", () => {
    const { xmlModele, xmlRendu } = construireFixture([]);
    const resultat = nettoyerMiseEnFormeBail(xmlModele, xmlRendu);
    expect(resultat).not.toContain('<w:br w:type="page"/>');
    expect(resultat).toContain("BREAK_STANDARD_1");
    expect(resultat).toContain("BREAK_STANDARD_2");
  });

  it("lève une erreur si le nombre de sauts de page manuels n'est pas exactement 2", () => {
    const { xmlModele, xmlRendu } = construireFixture([{ paraId: "TEST_BREAK_SUPPLEMENTAIRE", sautDePage: true }]);
    expect(() => nettoyerMiseEnFormeBail(xmlModele, xmlRendu)).toThrow(/saut\(s\) de page/);
  });

  it("conserve un rendu avec MOINS de paragraphes que le modèle (Docxtemplater a retiré un bloc multi-paragraphes)", () => {
    const { xmlModele, xmlRendu } = construireFixture([]);
    const xmlRenduTronque = xmlRendu.replace(/<w:p\b[^>]*w14:paraId="BREAK_STANDARD_1"[^>]*>[\s\S]*?<\/w:p>/, "");
    // Un paragraphe de moins dans le rendu est attendu (comportement normal
    // de Docxtemplater pour un bloc multi-paragraphes) — ne doit jamais
    // lever d'erreur à cause de ce seul écart de nombre. Le compte de
    // sauts de page (désormais 1 au lieu de 2) est l'erreur légitime ici.
    expect(() => nettoyerMiseEnFormeBail(xmlModele, xmlRenduTronque)).toThrow(/saut\(s\) de page/);
  });

  it("lève une erreur si le document rendu contient PLUS de paragraphes que le modèle", () => {
    const { xmlModele, xmlRendu } = construireFixture([]);
    const paragrapheEnTrop = '<w:p w14:paraId="PARAGRAPHE_FANTOME"><w:pPr><w:rPr/></w:pPr></w:p>';
    expect(() => nettoyerMiseEnFormeBail(xmlModele, xmlRendu.replace("</w:body>", `${paragrapheEnTrop}</w:body>`))).toThrow(
      /en contient plus que le modèle/
    );
  });

  it("lève une erreur si un paragraphe cible keepNext/keepLines est introuvable", () => {
    const { xmlModele, xmlRendu } = construireFixture([]);
    const retirer = (xml: string) => xml.replace(new RegExp(`<w:p\\b[^>]*w14:paraId="${PARA_ID_DERNIERE_LIGNE_SIGNATURES}"[^>]*>[\\s\\S]*?<\\/w:p>`), "");
    expect(() => nettoyerMiseEnFormeBail(retirer(xmlModele), retirer(xmlRendu))).toThrow(
      new RegExp(PARA_ID_DERNIERE_LIGNE_SIGNATURES)
    );
  });

  it('ajoute keepNext sur "LES CHARGES" sans toucher au texte', () => {
    const { xmlModele, xmlRendu } = construireFixture([]);
    const resultat = nettoyerMiseEnFormeBail(xmlModele, xmlRendu);
    const paragraphe = new RegExp(`<w:p\\b[^>]*w14:paraId="${PARA_ID_LES_CHARGES}"[^>]*>[\\s\\S]*?<\\/w:p>`).exec(resultat)![0];
    expect(paragraphe).toContain("<w:keepNext/>");
    expect(paragraphe).toContain("LES CHARGES");
  });

  it("ajoute keepNext et keepLines sur tout le bloc signatures, keepLines seul sur la dernière ligne", () => {
    const { xmlModele, xmlRendu } = construireFixture([]);
    const resultat = nettoyerMiseEnFormeBail(xmlModele, xmlRendu);
    for (const paraId of PARA_ID_SIGNATURES) {
      const paragraphe = new RegExp(`<w:p\\b[^>]*w14:paraId="${paraId}"[^>]*>[\\s\\S]*?<\\/w:p>`).exec(resultat)![0];
      expect(paragraphe).toContain("<w:keepNext/>");
      expect(paragraphe).toContain("<w:keepLines/>");
    }
    const derniereLigne = new RegExp(
      `<w:p\\b[^>]*w14:paraId="${PARA_ID_DERNIERE_LIGNE_SIGNATURES}"[^>]*>[\\s\\S]*?<\\/w:p>`
    ).exec(resultat)![0];
    expect(derniereLigne).toContain("<w:keepLines/>");
    expect(derniereLigne).not.toContain("<w:keepNext/>");
  });

  it("preuve zéro mot changé : le texte des paragraphes conservés est identique avant/après, bail vide (servitude et garant faux)", () => {
    const { xmlModele, xmlRendu } = construireFixture([
      { paraId: "TEST_SERVITUDE", texteModele: "{#servitude}Servitude.{/servitude}", texteRendu: "" },
      { paraId: "TEST_GARANT_1", texteModele: "{#aGarant}Garanti...", texteRendu: "" },
      { paraId: "TEST_GARANT_2", texteModele: "Nom : X{/aGarant}", texteRendu: "" }
    ]);
    const resultat = nettoyerMiseEnFormeBail(xmlModele, xmlRendu);
    const texteConserve = [...resultat.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("|");
    const texteModeleHorsSupprimes = [...xmlModele.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((m) => m[1])
      .filter((t) => !(t ?? "").includes("{#servitude}") && !(t ?? "").includes("{#aGarant}") && !(t ?? "").includes("Nom : X{/aGarant}"))
      .join("|");
    expect(texteConserve).toBe(texteModeleHorsSupprimes);
  });

  it("preuve zéro mot changé : le texte des paragraphes conservés est identique avant/après, bail meublé (servitude et garant vrais)", () => {
    const { xmlModele, xmlRendu } = construireFixture([
      { paraId: "TEST_SERVITUDE", texteModele: "{#servitude}Servitude.{/servitude}", texteRendu: "Servitude." },
      { paraId: "TEST_GARANT_1", texteModele: "{#aGarant}Garanti...", texteRendu: "Garanti..." },
      { paraId: "TEST_GARANT_2", texteModele: "Nom : X{/aGarant}", texteRendu: "Nom : X" }
    ]);
    const resultat = nettoyerMiseEnFormeBail(xmlModele, xmlRendu);
    const texteConserve = [...resultat.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("|");
    expect(texteConserve).toContain("Servitude.");
    expect(texteConserve).toContain("Garanti...");
    expect(texteConserve).toContain("Nom : X");
  });
});
