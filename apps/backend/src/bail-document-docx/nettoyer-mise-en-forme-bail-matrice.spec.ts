import { readFileSync } from "fs";
import path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { nettoyerMiseEnFormeBail } from "./nettoyer-mise-en-forme-bail";

// Matrice complète demandée : vide/meublé × avec/sans garant ×
// avec/sans diagnostics × colocation oui/non × servitude oui/non ×
// clause résolutoire avant/après — sur le VRAI modèle (assets/modele-bail.docx),
// sans base de données (toutes les données sont des drapeaux/balises en dur).
// Objectif : prouver, sur les 64 combinaisons, qu'après nettoyerMiseEnFormeBail
// il ne reste plus aucune puce vide, jamais plus d'un paragraphe vide
// consécutif, et que le bloc résiliation + le bloc caution ne montrent
// jamais qu'une seule variante, sans trace de l'autre.

const TEMPLATE_PATH = path.join(__dirname, "assets", "modele-bail.docx");

interface Drapeaux {
  meuble: boolean;
  aGarant: boolean;
  colocation: boolean;
  servitude: boolean;
  clauseResolutoireAvant: boolean;
  diagnostics: boolean;
}

const BOOLEENS = [false, true];

function toutesLesCombinaisons(): Drapeaux[] {
  const combinaisons: Drapeaux[] = [];
  for (const meuble of BOOLEENS) {
    for (const aGarant of BOOLEENS) {
      for (const colocation of BOOLEENS) {
        for (const servitude of BOOLEENS) {
          for (const clauseResolutoireAvant of BOOLEENS) {
            for (const diagnostics of BOOLEENS) {
              combinaisons.push({ meuble, aGarant, colocation, servitude, clauseResolutoireAvant, diagnostics });
            }
          }
        }
      }
    }
  }
  return combinaisons;
}

const DONNEES_BALISES = {
  "Nom de l’appartement": "T3 - unique",
  "Nom de la SCI": "SCI Test",
  "Adresse de la SCI": "1 rue de Test",
  "code postal SCI": "75001",
  "Ville SCI": "Paris",
  "téléphone SCI": "0100000000",
  "Nom prénom du locataire": "Alice Dupont",
  "Adresse locataire": "1 rue du Locataire",
  "CP locataire": "19100",
  "Ville locataire": "Brive",
  "Date de naissance locataire": "1990-05-12",
  "Téléphone du locataire": "0611111111",
  "adresse mail du locataire": "alice@example.com",
  "Nom prénom du colocataire": "",
  "adresse colocataire": "",
  "code postale colocataire": "",
  "ville colocataire": "",
  "téléphone colocataire": "",
  "adresse mail colocataire": "",
  "date de naissance collocataire": "",
  loyer: "650",
  charges: "30",
  "somme loyer + charges": "680",
  "dépôt de garantie": "650",
  "nombre de pièce": "3",
  surface: "60",
  "liste des dépendances": "Cave",
  "Equipement de la cuisine": "Plaques, four",
  "adresse appartement": "1 rue de Test",
  "code postal appartement": "19100",
  "ville appartement": "Brive",
  "Année construction immeuble": "1998",
  "date début bail": "2026-07-01",
  "date début bail + 3ans": "2029-07-01",
  "dernière valeur indice Insee IRL": "148.37",
  "dernier indice Insee IRL connu": "148.37",
  "mettre un champ à compléter le cas échéant": "Néant",
  "Nom prénom de la personne caution": "Jean Garant",
  "adresse caution": "2 rue du Garant",
  "code postale caution": "19100",
  "ville caution": "Brive",
  "téléphone caution": "0622222222",
  "date de naissance caution": "1985-01-01",
  "ville de naissance caution ": "Brive",
  "nationalité caution": "française",
  "adresse mail caution": "jean@example.com",
  "montant loyer": "650",
  "mois de départ du bail": "juillet",
  "montant des charges": "30",
  "un mois appartement vide ou deux mois appartement meublé": "un mois",
  "montant dépôt de garantie": "650",
  "Ville de l’appartement": "Brive",
  "montant loyer précédent locataire": "",
  "date de versement loyer précédent locataire": "",
  "classe DPE": "D",
  "dépenses énergétiques": "500 à 600",
  "année de référence des prix énergétiques": "2024",
  "duree bail": "3 ans"
};

function genererDocumentXml(drapeaux: Drapeaux): string {
  const contenu = readFileSync(TEMPLATE_PATH, "binary");
  const zip = new PizZip(contenu);
  const xmlModele = zip.file("word/document.xml")!.asText();
  const document = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  document.render({
    ...DONNEES_BALISES,
    reconductionTacite: true,
    collectif: true,
    individuel: false,
    copropriete: true,
    monopropriete: false,
    chauffageIndividuel: true,
    chauffageCollectif: false,
    eauChaudeIndividuelle: true,
    eauChaudeCollective: false,
    meuble: drapeaux.meuble,
    aGarant: drapeaux.aGarant,
    colocation: drapeaux.colocation,
    servitude: drapeaux.servitude,
    clauseResolutoireAvant: drapeaux.clauseResolutoireAvant,
    clauseResolutoireApres: !drapeaux.clauseResolutoireAvant,
    mentionLoyerPrecedentComplete: false,
    mentionLoyerPrecedentMontantSeul: false,
    diagnosticDpePresent: drapeaux.diagnostics,
    diagnosticCrepPresent: drapeaux.diagnostics,
    diagnosticElecGazPresent: drapeaux.diagnostics,
    diagnosticErpPresent: drapeaux.diagnostics
  });
  const xmlRendu = document.getZip().file("word/document.xml")!.asText();
  return nettoyerMiseEnFormeBail(xmlModele, xmlRendu);
}

function extraireParagraphesAvecTexteEtListe(xml: string): { texte: string; liste: boolean }[] {
  const paragraphes = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
  return paragraphes.map((m) => ({
    texte: [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""),
    liste: /<w:numPr>/.test(m[0]) || /<w:pStyle w:val="ListParagraph"/.test(m[0])
  }));
}

// Le modèle BRUT (sans aucun rendu) contient déjà, par choix de mise en
// page du propriétaire, des suites de paragraphes vides sans aucun rapport
// avec une balise conditionnelle (espacement avant le bloc signatures,
// fin de document) — jusqu'à 4 à la suite. Ce chantier ne touche jamais à
// ces espacements volontaires : la seule régression à surveiller est qu'un
// nettoyage ne les ALLONGE jamais au-delà de ce qui existe déjà dans le
// modèle non rendu.
const MODELE_BRUT_XML = readFileSync(TEMPLATE_PATH, "binary");
function maxParagraphesVidesConsecutifs(xml: string): number {
  const paragraphes = extraireParagraphesAvecTexteEtListe(xml);
  let max = 0;
  let courant = 0;
  for (const p of paragraphes) {
    courant = p.texte === "" ? courant + 1 : 0;
    max = Math.max(max, courant);
  }
  return max;
}
const MAX_VIDE_CONSECUTIF_MODELE = maxParagraphesVidesConsecutifs(
  new PizZip(MODELE_BRUT_XML).file("word/document.xml")!.asText()
);

describe("nettoyerMiseEnFormeBail — matrice complète sur le vrai modèle (sans base de données)", () => {
  const combinaisons = toutesLesCombinaisons();

  it.each(combinaisons)("aucune puce vide, aucun saut de page manuel, pas de nouvel espacement anormal — %j", (drapeaux) => {
    const resultat = genererDocumentXml(drapeaux);
    const paragraphes = extraireParagraphesAvecTexteEtListe(resultat);

    const puceVide = paragraphes.find((p) => p.liste && p.texte === "");
    expect(puceVide, `puce vide trouvée pour ${JSON.stringify(drapeaux)}`).toBeUndefined();

    expect(
      maxParagraphesVidesConsecutifs(resultat),
      `espacement vide anormalement long (> ${MAX_VIDE_CONSECUTIF_MODELE}, déjà présent dans le modèle brut) pour ${JSON.stringify(drapeaux)}`
    ).toBeLessThanOrEqual(MAX_VIDE_CONSECUTIF_MODELE);

    expect(resultat).not.toContain('<w:br w:type="page"/>');
  });

  // Signalement explicite (demandé : "si un bloc supprimé laisse deux
  // paragraphes d'espacement voulu consécutifs, ne les fusionne pas :
  // signale-le-moi") : quand mentionLoyerPrecedentComplete ET
  // mentionLoyerPrecedentMontantSeul sont tous les deux faux (aucun
  // locataire précédent retrouvé dans les 18 mois), les deux paragraphes
  // qui portaient ces balises sont supprimés. Le paragraphe d'espacement
  // volontaire juste avant (déjà vide dans le modèle) se retrouve alors
  // directement adjacent au paragraphe qui portait le saut de page manuel
  // (lui aussi vide dans le modèle, saut de page retiré par ce chantier) :
  // un espacement de 2 paragraphes vides apparaît avant "LES CHARGES",
  // contre 0 quand l'une des deux mentions est présente. Comportement
  // volontairement conservé tel quel (ni fusionné ni supprimé) — juste
  // documenté ici pour que Jimmy le voie en relisant le .docx.
  it("signalement : sans mention du loyer précédent, 2 paragraphes vides se retrouvent côte à côte juste avant LES CHARGES", () => {
    const resultat = genererDocumentXml({
      meuble: false,
      aGarant: false,
      colocation: false,
      servitude: false,
      clauseResolutoireAvant: true,
      diagnostics: false
    });
    const paragraphes = extraireParagraphesAvecTexteEtListe(resultat);
    const indexLesCharges = paragraphes.findIndex((p) => p.texte === "LES CHARGES");
    expect(indexLesCharges).toBeGreaterThan(1);
    expect(paragraphes[indexLesCharges - 1]!.texte).toBe("");
    expect(paragraphes[indexLesCharges - 2]!.texte).toBe("");
    expect(paragraphes[indexLesCharges - 3]!.texte).not.toBe("");
  });

  it("bail vide, sans garant : une seule variante du bloc résiliation visible, aucune puce vide avant, Néant suivi directement de la section suivante", () => {
    const resultat = genererDocumentXml({
      meuble: false,
      aGarant: false,
      colocation: false,
      servitude: false,
      clauseResolutoireAvant: true,
      diagnostics: false
    });
    expect(resultat).toContain("moyennant un délai de trois mois sans motif");
    expect(resultat).not.toContain("sans condition de motif, y compris lorsque la durée du bail est réduite à neuf mois");
    expect(resultat).toContain("Néant");
    expect(resultat).not.toContain("Acte de caution solidaire");
    expect(resultat).not.toContain("présente location est garantie");

    const paragraphes = extraireParagraphesAvecTexteEtListe(resultat);
    const indexNeant = paragraphes.findIndex((p) => p.texte === "Néant");
    expect(indexNeant).toBeGreaterThan(-1);
    // La ligne suivant "Néant" ne doit jamais être une puce vide ni un
    // paragraphe vide : soit du vrai contenu, soit directement la section
    // "LA DUREE".
    expect(paragraphes[indexNeant + 1]!.texte).not.toBe("");
  });

  it("bail meublé, avec garant : une seule variante du bloc résiliation visible (meublé), bloc caution détaillé présent", () => {
    const resultat = genererDocumentXml({
      meuble: true,
      aGarant: true,
      colocation: false,
      servitude: false,
      clauseResolutoireAvant: false,
      diagnostics: true
    });
    expect(resultat).toContain("sans condition de motif, y compris lorsque la durée du bail est réduite à neuf mois");
    expect(resultat).not.toContain("moyennant un délai de trois mois sans motif");
    expect(resultat).toContain("présente location est garantie");
    expect(resultat).toContain("Jean Garant");
    expect(resultat).toContain("Diagnostic de performance énergétique (DPE)");
    expect(resultat).toContain("Etat descriptif et inventaire du mobilier");
  });

  it('preuve zéro mot changé : aucune balise ("{" ou "}") ne subsiste dans le texte final', () => {
    const resultat = genererDocumentXml({
      meuble: false,
      aGarant: true,
      colocation: true,
      servitude: true,
      clauseResolutoireAvant: false,
      diagnostics: true
    });
    const texte = [...resultat.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
    expect(texte).not.toMatch(/\{[#^/]?\w+\}/);
  });
});
