export interface LigneReleveCsv {
  date: string;
  montant: string;
  libelle: string;
}

const ENTETES_DATE = ["date"];
const ENTETES_MONTANT = ["montant", "amount", "credit"];
const ENTETES_LIBELLE = ["libelle", "description", "reference", "libelle operation"];

function normaliserTexte(valeur: string): string {
  return valeur
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function detecterDelimiteur(contenu: string): string {
  const premiereLigne = contenu.split(/\r?\n/, 1)[0] ?? "";
  const nbPointVirgule = (premiereLigne.match(/;/g) ?? []).length;
  const nbVirgule = (premiereLigne.match(/,/g) ?? []).length;
  return nbPointVirgule > nbVirgule ? ";" : ",";
}

// Parseur CSV minimal (RFC4180 simplifié) : champs entre guillemets avec
// délimiteur/retour à la ligne échappés, guillemet doublé pour un guillemet
// littéral. Pas de dépendance externe (packages/core reste TypeScript pur).
function decouperLignesCsv(contenu: string): string[][] {
  const delimiteur = detecterDelimiteur(contenu);
  const texte = contenu.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lignes: string[][] = [];
  let ligneCourante: string[] = [];
  let champCourant = "";
  let dansGuillemets = false;

  for (let i = 0; i < texte.length; i++) {
    const caractere = texte[i];

    if (dansGuillemets) {
      if (caractere === '"') {
        if (texte[i + 1] === '"') {
          champCourant += '"';
          i++;
        } else {
          dansGuillemets = false;
        }
      } else {
        champCourant += caractere;
      }
      continue;
    }

    if (caractere === '"') {
      dansGuillemets = true;
    } else if (caractere === delimiteur) {
      ligneCourante.push(champCourant);
      champCourant = "";
    } else if (caractere === "\n") {
      ligneCourante.push(champCourant);
      lignes.push(ligneCourante);
      ligneCourante = [];
      champCourant = "";
    } else {
      champCourant += caractere;
    }
  }
  if (champCourant !== "" || ligneCourante.length > 0) {
    ligneCourante.push(champCourant);
    lignes.push(ligneCourante);
  }

  return lignes.filter((ligne) => !(ligne.length === 1 && (ligne[0] ?? "").trim() === ""));
}

function normaliserDateCsv(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  const matchFr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (matchFr) {
    const [, jour, mois, annee] = matchFr;
    return `${annee}-${mois}-${jour}`;
  }
  throw new Error(`Date invalide dans le CSV : "${date}" (formats acceptés : JJ/MM/AAAA ou AAAA-MM-JJ).`);
}

function trouverColonnesCorrespondantes(entetes: string[], candidats: string[]): number[] {
  return entetes
    .map((entete, index) => ({ entete, index }))
    .filter(({ entete }) => candidats.some((candidat) => entete.includes(normaliserTexte(candidat))))
    .map(({ index }) => index);
}

// Retourne l'unique colonne correspondante — échoue bruyamment si aucune ou
// si PLUSIEURS colonnes de l'en-tête correspondent au même nom recherché
// (ex. "Libellé" et "Référence" toutes deux présentes) : deviner laquelle
// prendre serait exactement le genre d'erreur silencieuse que ce parseur
// refuse par ailleurs (voir parserReleveCsv).
function trouverColonneUnique(entetes: string[], candidats: string[], nomChamp: string): number {
  const correspondances = trouverColonnesCorrespondantes(entetes, candidats);
  if (correspondances.length > 1) {
    const nomsColonnes = correspondances.map((index) => `"${entetes[index]}"`).join(", ");
    throw new Error(
      `Colonne "${nomChamp}" ambiguë : plusieurs colonnes de l'en-tête correspondent (${nomsColonnes}).`
    );
  }
  return correspondances[0] ?? -1;
}

/**
 * Parse un relevé bancaire CSV : en-tête obligatoire, colonnes identifiées
 * par nom (insensible à la casse/accents, tolère quelques variantes
 * courantes) plutôt que par position fixe — les formats varient d'une
 * banque à l'autre. Échoue bruyamment si une colonne requise (date,
 * montant, libellé) est introuvable ou si une ligne est incomplète : mieux
 * vaut refuser l'import que deviner (docs/backlog.md, Module 5 — "erreur
 * ici = erreur financière").
 */
export function parserReleveCsv(contenu: string): LigneReleveCsv[] {
  const lignes = decouperLignesCsv(contenu);
  if (lignes.length === 0) {
    throw new Error("Fichier CSV vide.");
  }

  const premiereLigne = lignes[0];
  if (!premiereLigne) {
    throw new Error("Fichier CSV vide.");
  }
  const entetes = premiereLigne.map(normaliserTexte);
  const indexDate = trouverColonneUnique(entetes, ENTETES_DATE, "date");
  const indexMontant = trouverColonneUnique(entetes, ENTETES_MONTANT, "montant");
  const indexLibelle = trouverColonneUnique(entetes, ENTETES_LIBELLE, "libellé");

  if (indexDate === -1) {
    throw new Error('Colonne "date" introuvable dans l\'en-tête du CSV.');
  }
  if (indexMontant === -1) {
    throw new Error('Colonne "montant" introuvable dans l\'en-tête du CSV.');
  }
  if (indexLibelle === -1) {
    throw new Error('Colonne "libellé" introuvable dans l\'en-tête du CSV.');
  }

  return lignes
    .slice(1)
    .filter((champs) => champs.some((champ) => champ.trim() !== ""))
    .map((champs, index) => {
      const date = champs[indexDate]?.trim() ?? "";
      const montant = champs[indexMontant]?.trim() ?? "";
      const libelle = champs[indexLibelle]?.trim() ?? "";
      if (!date || !montant) {
        throw new Error(`Ligne ${index + 2} du CSV incomplète (date ou montant manquant).`);
      }
      return { date: normaliserDateCsv(date), montant, libelle };
    });
}
