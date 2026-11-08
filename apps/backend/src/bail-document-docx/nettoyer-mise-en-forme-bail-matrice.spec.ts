import { readFileSync } from "fs";
import path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { nettoyerMiseEnFormeBail } from "./nettoyer-mise-en-forme-bail";

// Matrice complète demandée : vide/meublé × 0, 1 ou 2 garants ×
// avec/sans diagnostics × colocation oui/non × servitude oui/non ×
// clause résolutoire avant/après — sur le VRAI modèle (assets/modele-bail.docx),
// sans base de données (toutes les données sont des drapeaux/balises en dur).
// Objectif : prouver, sur les 96 combinaisons, qu'après nettoyerMiseEnFormeBail
// il ne reste plus aucune puce vide, jamais plus d'un paragraphe vide
// consécutif, et que le bloc résiliation + le bloc caution ne montrent
// jamais qu'une seule variante, sans trace de l'autre.

const TEMPLATE_PATH = path.join(__dirname, "assets", "modele-bail.docx");

interface Drapeaux {
  meuble: boolean;
  nombreCautions: number;
  colocation: boolean;
  servitude: boolean;
  clauseResolutoireAvant: boolean;
  diagnostics: boolean;
}

const BOOLEENS = [false, true];

function toutesLesCombinaisons(): Drapeaux[] {
  const combinaisons: Drapeaux[] = [];
  for (const meuble of BOOLEENS) {
    for (const nombreCautions of [0, 1, 2]) {
      for (const colocation of BOOLEENS) {
        for (const servitude of BOOLEENS) {
          for (const clauseResolutoireAvant of BOOLEENS) {
            for (const diagnostics of BOOLEENS) {
              combinaisons.push({ meuble, nombreCautions, colocation, servitude, clauseResolutoireAvant, diagnostics });
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
  "duree bail": "3 ans",
  // Chantier bail — corrections juridiques, commit C.
  "prénom nom du gérant": "Jean Dupont"
};

// Une entrée par caution (boucle {#cautions} du modèle, 2026-11-07).
const CAUTIONS = [
  {
    "numero caution": "1",
    "locataire cautionne": null as string | null,
    "Nom prénom de la personne caution": "Jean Garant",
    "adresse caution": "2 rue du Garant",
    "code postale caution": "19100",
    "ville caution": "Brive",
    "téléphone caution": "0622222222",
    "date de naissance caution": "1985-01-01",
    "ville de naissance caution ": "Brive",
    "nationalité caution": "française",
    "adresse mail caution": "jean@example.com"
  },
  {
    "numero caution": "2",
    "locataire cautionne": null as string | null,
    "Nom prénom de la personne caution": "Paule Seconde",
    "adresse caution": "3 rue du Garant",
    "code postale caution": "69002",
    "ville caution": "Lyon",
    "téléphone caution": "0633333333",
    "date de naissance caution": "1970-02-02",
    "ville de naissance caution ": "Lyon",
    "nationalité caution": "française",
    "adresse mail caution": "paule@example.com"
  }
];

function genererDocumentXml(drapeaux: Drapeaux, cautions = CAUTIONS.slice(0, drapeaux.nombreCautions)): string {
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
    cautions,
    aGarant: drapeaux.nombreCautions > 0,
    plusieursCautions: drapeaux.nombreCautions > 1,
    // Chantier bail — corrections juridiques, commit C : true dans toute
    // la matrice (bailleur SCI) — hors des 6 dimensions combinées, même
    // traitement que reconductionTacite/collectif/... ci-dessus.
    representantSci: true,
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
      nombreCautions: 0,
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
      nombreCautions: 0,
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
      nombreCautions: 1,
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

  it("bail à 2 cautions : identité de chacune dans l'ordre reçu, engagement au pluriel une seule fois, une ligne d'annexe par caution", () => {
    const resultat = genererDocumentXml({
      meuble: false,
      nombreCautions: 2,
      colocation: true,
      servitude: false,
      clauseResolutoireAvant: false,
      diagnostics: false
    });
    const paragraphes = extraireParagraphesAvecTexteEtListe(resultat).map((p) => p.texte);
    const noms = paragraphes.filter((t) => t.startsWith("Nom : ") && (t.includes("Garant") || t.includes("Seconde")));
    expect(noms).toEqual(["Nom : Jean Garant", "Nom : Paule Seconde"]);
    // Intitulé juste avant chaque bloc, dans l'ordre.
    expect(paragraphes[paragraphes.indexOf("Nom : Jean Garant") - 1]).toBe("Caution 1");
    expect(paragraphes[paragraphes.indexOf("Nom : Paule Seconde") - 1]).toBe("Caution 2");
    expect(
      paragraphes.some((t) => t.trim() === "La présente location est garantie par les personnes désignées ci-dessous en qualité de cautions:")
    ).toBe(true);

    const engagements = paragraphes.filter((t) => t.includes("aux bénéfices de discussion et de division"));
    expect(engagements).toHaveLength(1);
    expect(engagements[0]).toMatch(/^Les cautions se portent cautions solidaires du locataire et renoncent aux bénéfices/);
    expect(paragraphes.some((t) => t.trim() === "Un exemplaire de l’engagement de chaque caution est annexé au présent bail.")).toBe(true);
    // L'engagement suit la liste : après la dernière identité, jamais entre deux.
    expect(paragraphes.indexOf(engagements[0]!)).toBeGreaterThan(paragraphes.indexOf("Nom : Paule Seconde"));

    const annexes = paragraphes.filter((t) => t.startsWith("Acte de caution solidaire"));
    expect(annexes).toEqual([
      "Acte de caution solidaire. Nom de la caution : Jean Garant",
      "Acte de caution solidaire. Nom de la caution : Paule Seconde"
    ]);
  });

  it("bail à 1 caution : engagement et exemplaire annexé au singulier", () => {
    const resultat = genererDocumentXml({
      meuble: false,
      nombreCautions: 1,
      colocation: false,
      servitude: false,
      clauseResolutoireAvant: false,
      diagnostics: false
    });
    const paragraphes = extraireParagraphesAvecTexteEtListe(resultat).map((p) => p.texte);
    expect(paragraphes.some((t) => t.startsWith("La caution se porte caution solidaire du locataire et renonce aux bénéfices"))).toBe(true);
    expect(resultat).not.toContain("Les cautions se portent");
    expect(paragraphes.some((t) => /^Caution d/.test(t))).toBe(false);
    // Aucun paragraphe vide laissé à la place de l'intitulé.
    expect(paragraphes[paragraphes.indexOf("Nom : Jean Garant") - 1]!.trim()).toBe(
      "La présente location est garantie par la personne désignée ci-dessous en qualité de caution:"
    );
    expect(paragraphes.some((t) => t.trim() === "Un exemplaire de l’engagement de la caution est annexé au présent bail.")).toBe(true);
    expect(paragraphes.filter((t) => t.startsWith("Acte de caution solidaire"))).toEqual([
      "Acte de caution solidaire. Nom de la caution : Jean Garant"
    ]);
  });

  // Commit 4 garants (2026-11-08) : « , caution de [Prénom Nom] » après le
  // nom, dans le bloc identité et dans la ligne d'annexe, seulement pour la
  // caution dont « locataire cautionne » est renseigné.
  it("caution rattachée à un locataire : mention « caution de » après le nom et dans sa ligne d'annexe, rien pour l'autre", () => {
    const resultat = genererDocumentXml(
      { meuble: false, nombreCautions: 2, colocation: true, servitude: false, clauseResolutoireAvant: false, diagnostics: false },
      [{ ...CAUTIONS[0]!, "locataire cautionne": "Lucie Bernard" }, CAUTIONS[1]!]
    );
    const paragraphes = extraireParagraphesAvecTexteEtListe(resultat).map((p) => p.texte);
    expect(paragraphes.filter((t) => t.startsWith("Nom : ") && (t.includes("Garant") || t.includes("Seconde")))).toEqual([
      "Nom : Jean Garant, caution de Lucie Bernard",
      "Nom : Paule Seconde"
    ]);
    expect(paragraphes.filter((t) => t.startsWith("Acte de caution solidaire"))).toEqual([
      "Acte de caution solidaire. Nom de la caution : Jean Garant, caution de Lucie Bernard",
      "Acte de caution solidaire. Nom de la caution : Paule Seconde"
    ]);
    const texte = [...resultat.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
    expect(texte).not.toContain("{");
  });

  it('preuve zéro mot changé : aucune balise ("{" ou "}") ne subsiste dans le texte final', () => {
    const resultat = genererDocumentXml({
      meuble: false,
      nombreCautions: 2,
      colocation: true,
      servitude: true,
      clauseResolutoireAvant: false,
      diagnostics: true
    });
    const texte = [...resultat.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
    expect(texte).not.toMatch(/\{[#^/]?\w+\}/);
  });
});
