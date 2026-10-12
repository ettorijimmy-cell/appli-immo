/**
 * Nettoyage de mise en forme du bail généré, APRÈS le rendu Docxtemplater,
 * SANS jamais toucher au texte juridique lui-même (voir
 * nettoyer-mise-en-forme-bail.spec.ts, "preuve zéro mot changé").
 *
 * Constat empirique (vérifié en rendant le vrai modèle) : avec
 * `paragraphLoop: true`, Docxtemplater supprime déjà lui-même, proprement,
 * les blocs conditionnels qui s'étendent sur PLUSIEURS paragraphes entiers
 * (ex. le bloc caution détaillé, le bloc résiliation vide/meublé) — ces
 * `<w:p>` disparaissent du document rendu, le nombre de paragraphes du
 * document rendu est donc normalement INFÉRIEUR à celui du modèle, et
 * varie selon les branches activées. Seuls les blocs conditionnels tenant
 * TOUT ENTIER DANS UN SEUL paragraphe (ouverture et fermeture sur la même
 * ligne, ex. une puce de pièce annexée) laissent un paragraphe vide derrière
 * eux quand la condition est fausse : ce sont les seuls que cette fonction
 * doit nettoyer. D'où une corrélation par `w14:paraId` (identifiant Word
 * stable, préservé par Docxtemplater pour tout paragraphe qu'il conserve)
 * plutôt que par position : un paragraphe du modèle peut tout simplement
 * ne plus exister dans le rendu, Docxtemplater l'ayant déjà retiré.
 *
 * Trois opérations, dans cet ordre :
 * 1. Suppression des paragraphes vidés par une balise conditionnelle fausse :
 *    a) toute puce (paragraphe avec numérotation de liste) vide après rendu
 *       est supprimée sans condition — vérifié sur le modèle non rendu
 *       (42 puces, 0 vide) : aucune puce n'est vide par choix de mise en
 *       page, une puce vide est donc TOUJOURS un résidu de balise fausse.
 *       Nécessaire aussi pour les paragraphes SANS `w14:paraId` (certains
 *       ajouts manuels du modèle, ex. le bloc meublé de la clause de
 *       résiliation, n'en portent pas) : Docxtemplater laisse parfois un
 *       paragraphe résiduel vide pour un bloc multi-paragraphes qu'il a
 *       par ailleurs correctement réduit à zéro itération — corrélation
 *       par `w14:paraId` impossible dans ce cas précis.
 *    b) pour les paragraphes non-listes porteurs d'un `w14:paraId` : NON
 *       vide dans le modèle (texte ou balise) ET vide après rendu (ligne
 *       de mention loyer précédent, servitude, colocation...). Les
 *       paragraphes déjà vides dans le modèle (espacement voulu) ne sont
 *       jamais concernés.
 * 2. Suppression des deux sauts de page manuels du modèle (avant
 *    "LES CHARGES" et avant "Fait à") : les paragraphes vides restent,
 *    seul le `<w:br w:type="page"/>` qu'ils contiennent disparaît.
 * 3. `keepNext`/`keepLines` sur les paragraphes du bloc signatures (pour
 *    qu'il ne soit jamais coupé par un saut de page) et sur le titre
 *    "LES CHARGES" (pour qu'il ne reste jamais seul en bas de page) — ciblés
 *    par `w14:paraId`, pas par position.
 */

const REGEX_PARAGRAPHE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const REGEX_TEXTE_RUN = /<w:t[^>]*>([^<]*)<\/w:t>/g;
const REGEX_SAUT_DE_PAGE = /<w:br w:type="page"\/>/g;
const NOMBRE_SAUTS_DE_PAGE_ATTENDU = 2;

// w14:paraId du modèle (voir audit du 2026-10-11) — "Fait à" jusqu'à la
// dernière ligne du bloc signatures, pour que ce groupe ne soit jamais
// coupé par un saut de page.
const PARA_ID_KEEP_NEXT_ET_LINES = [
  "23B7E4E2", // Fait à ... en 2 EXEMPLAIRES...
  "60D47E4D", // (vide)
  "52FE45C2", // (Signatures précédées de la mention « lu et approuvé »)
  "7FC711FE", // (vide)
  "130A3A68", // (vide)
  "0A6F6873", // (vide)
  "6F06ADE2", // LE(S) BAILLEUR(S)
  "6E49BA73", // LE(S) PRENEUR(S)
  "1D82B7A7", // LA OU LES CAUTION(S)
  "4AEB3267", // « lu et approuvé »
  "3BF966F8", // (vide)
  "69F011DB", // (vide)
  "39E9EFA0" // « lu et approuvé »
] as const;
// Dernière ligne du bloc signatures : rien à garder avec la suite, mais
// toujours keepLines pour ne pas être coupée en plein milieu.
const PARA_ID_KEEP_LINES_SEUL = "5E9AAAA2";
// Titre "LES CHARGES" (page 3 du modèle) : ne doit jamais rester seul en
// bas de page.
const PARA_ID_KEEP_NEXT_SEUL = "00BF507F";

const REGEX_PARA_ID = /w14:paraId="([^"]+)"/;
const REGEX_LISTE = /<w:numPr>|<w:pStyle w:val="ListParagraph"/;

function extraireTexteParagraphe(paragrapheXml: string): string {
  return [...paragrapheXml.matchAll(REGEX_TEXTE_RUN)].map((m) => m[1]).join("");
}

function extraireParaId(paragrapheXml: string): string | null {
  return REGEX_PARA_ID.exec(paragrapheXml)?.[1] ?? null;
}

function estParagrapheDeListe(paragrapheXml: string): boolean {
  return REGEX_LISTE.test(paragrapheXml);
}

function extraireParagraphes(xml: string): RegExpMatchArray[] {
  return [...xml.matchAll(REGEX_PARAGRAPHE)];
}

function insererProprietesParagraphe(paragrapheXml: string, proprietes: readonly string[]): string {
  const balises = proprietes.map((p) => `<w:${p}/>`).join("");
  if (paragrapheXml.includes("<w:pPr/>")) {
    return paragrapheXml.replace("<w:pPr/>", `<w:pPr>${balises}</w:pPr>`);
  }
  if (paragrapheXml.includes("<w:pPr>")) {
    return paragrapheXml.replace("<w:pPr>", `<w:pPr>${balises}`);
  }
  return paragrapheXml.replace(/^(<w:p\b[^>]*>)/, `$1<w:pPr>${balises}</w:pPr>`);
}

function appliquerProprietesParParaId(xml: string, paraIds: readonly string[], proprietes: readonly string[]): string {
  let resultat = xml;
  for (const paraId of paraIds) {
    const regex = new RegExp(`<w:p\\b[^>]*w14:paraId="${paraId}"[^>]*>[\\s\\S]*?<\\/w:p>`);
    const match = regex.exec(resultat);
    if (!match) {
      throw new Error(
        `nettoyerMiseEnFormeBail : paragraphe avec w14:paraId="${paraId}" introuvable — le modèle a changé, cette fonction doit être revue.`
      );
    }
    const remplacement = insererProprietesParagraphe(match[0], proprietes);
    resultat = resultat.slice(0, match.index) + remplacement + resultat.slice(match.index! + match[0].length);
  }
  return resultat;
}

export function nettoyerMiseEnFormeBail(xmlModele: string, xmlRendu: string): string {
  const paragraphesModele = extraireParagraphes(xmlModele);
  const paragraphesRendu = extraireParagraphes(xmlRendu);

  if (paragraphesRendu.length > paragraphesModele.length) {
    throw new Error(
      `nettoyerMiseEnFormeBail : le document rendu (${paragraphesRendu.length} paragraphes) en contient plus que le modèle (${paragraphesModele.length}) — Docxtemplater ne devrait jamais en ajouter.`
    );
  }

  const texteModeleParParaId = new Map<string, string>();
  for (const match of paragraphesModele) {
    const paraId = extraireParaId(match[0]);
    if (paraId !== null) {
      texteModeleParParaId.set(paraId, extraireTexteParagraphe(match[0]));
    }
  }

  const indicesASupprimer = new Set<number>();
  paragraphesRendu.forEach((matchRendu, i) => {
    const texteRendu = extraireTexteParagraphe(matchRendu[0]);
    if (texteRendu !== "") {
      return;
    }
    // Toute puce vide est un résidu de balise fausse (voir commentaire de
    // tête) : supprimée sans corrélation, y compris sans w14:paraId.
    if (estParagrapheDeListe(matchRendu[0])) {
      indicesASupprimer.add(i);
      return;
    }
    const paraId = extraireParaId(matchRendu[0]);
    if (paraId === null) {
      return;
    }
    const texteModele = texteModeleParParaId.get(paraId);
    if (texteModele !== undefined && texteModele !== "") {
      indicesASupprimer.add(i);
    }
  });

  let resultat = "";
  let curseur = 0;
  paragraphesRendu.forEach((match, i) => {
    resultat += xmlRendu.slice(curseur, match.index);
    if (!indicesASupprimer.has(i)) {
      resultat += match[0];
    }
    curseur = match.index! + match[0].length;
  });
  resultat += xmlRendu.slice(curseur);

  const nombreSautsDePage = [...resultat.matchAll(REGEX_SAUT_DE_PAGE)].length;
  if (nombreSautsDePage !== NOMBRE_SAUTS_DE_PAGE_ATTENDU) {
    throw new Error(
      `nettoyerMiseEnFormeBail : ${nombreSautsDePage} saut(s) de page manuel(s) trouvé(s), ${NOMBRE_SAUTS_DE_PAGE_ATTENDU} attendu(s) — le modèle a changé, cette fonction doit être revue.`
    );
  }
  resultat = resultat.replace(REGEX_SAUT_DE_PAGE, "");

  resultat = appliquerProprietesParParaId(resultat, [PARA_ID_KEEP_NEXT_SEUL], ["keepNext"]);
  resultat = appliquerProprietesParParaId(resultat, PARA_ID_KEEP_NEXT_ET_LINES, ["keepNext", "keepLines"]);
  resultat = appliquerProprietesParParaId(resultat, [PARA_ID_KEEP_LINES_SEUL], ["keepLines"]);

  return resultat;
}
