export interface LigneReleveCsv {
  date: string;
  montant: string;
  libelle: string;
}

const ENTETES_DATE = ["date"];
const ENTETES_MONTANT = ["montant", "amount", "credit"];
const ENTETES_LIBELLE = ["libelle", "description", "reference", "libelle operation"];
// Format à deux colonnes (Débit/Crédit), distinct du format historique à
// colonne "montant" unique signée — voir le commentaire dans
// parserReleveCsv pour le mécanisme de détection. "credit" est déjà un
// candidat de ENTETES_MONTANT (certaines banques nomment ainsi leur
// colonne unique signée) : ENTETES_CREDIT reste une liste séparée, jamais
// consultée sauf si une colonne "débit" a déjà été trouvée, pour ne
// jamais confondre les deux formats.
const ENTETES_DEBIT = ["debit"];
const ENTETES_CREDIT = ["credit"];

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
 *
 * Deux formats de montant acceptés (Module Charges et fiscalité, Étape 1,
 * 2026-09-06 — export bancaire réel de Jimmy en deux colonnes) :
 * - Colonne "montant"/"amount"/"credit" unique, déjà signée (format
 *   historique, utilisé par le rapprochement des loyers).
 * - Colonnes "débit"/"crédit" séparées — détecté par la seule présence
 *   d'une colonne "débit" (jamais par la présence de "crédit" seule, déjà
 *   candidate du format à colonne unique — voir ENTETES_CREDIT). Fusionné
 *   en un montant signé unique : débit → négatif, crédit → positif,
 *   n'importe quel signe déjà présent dans la cellule source est retiré
 *   avant d'appliquer le nôtre, pour ne jamais dépendre de la convention
 *   du fichier d'origine. `LigneReleveCsv.montant` a exactement la même
 *   forme dans les deux cas — aucun changement pour les consommateurs en
 *   aval (`proposerRapprochements`, `montantEnCentimes`).
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
  const indexLibelle = trouverColonneUnique(entetes, ENTETES_LIBELLE, "libellé");
  if (indexDate === -1) {
    throw new Error('Colonne "date" introuvable dans l\'en-tête du CSV.');
  }
  if (indexLibelle === -1) {
    throw new Error('Colonne "libellé" introuvable dans l\'en-tête du CSV.');
  }

  const indexDebit = trouverColonneUnique(entetes, ENTETES_DEBIT, "débit");
  const indexCredit = indexDebit !== -1 ? trouverColonneUnique(entetes, ENTETES_CREDIT, "crédit") : -1;
  if (indexDebit !== -1 && indexCredit === -1) {
    throw new Error(
      'Colonne "crédit" introuvable alors qu\'une colonne "débit" est présente (format à deux colonnes incomplet).'
    );
  }
  const indexMontant = indexDebit === -1 ? trouverColonneUnique(entetes, ENTETES_MONTANT, "montant") : -1;
  if (indexDebit === -1 && indexMontant === -1) {
    throw new Error('Colonne "montant" introuvable dans l\'en-tête du CSV.');
  }

  return lignes
    .slice(1)
    .filter((champs) => champs.some((champ) => champ.trim() !== ""))
    .map((champs, index) => {
      const numeroLigne = index + 2;
      const date = champs[indexDate]?.trim() ?? "";
      const libelle = champs[indexLibelle]?.trim() ?? "";
      if (!date) {
        throw new Error(`Ligne ${numeroLigne} du CSV incomplète (date manquante).`);
      }

      let montant: string;
      if (indexDebit !== -1) {
        const debitBrut = champs[indexDebit]?.trim() ?? "";
        const creditBrut = champs[indexCredit]?.trim() ?? "";
        if (debitBrut !== "" && creditBrut !== "") {
          throw new Error(
            `Ligne ${numeroLigne} du CSV ambiguë : débit ("${debitBrut}") et crédit ("${creditBrut}") renseignés simultanément.`
          );
        }
        if (debitBrut === "" && creditBrut === "") {
          throw new Error(`Ligne ${numeroLigne} du CSV incomplète (ni débit ni crédit renseigné).`);
        }
        montant = debitBrut !== "" ? `-${debitBrut.replace(/^-/, "")}` : creditBrut.replace(/^-/, "");
      } else {
        montant = champs[indexMontant]?.trim() ?? "";
        if (!montant) {
          throw new Error(`Ligne ${numeroLigne} du CSV incomplète (montant manquant).`);
        }
      }

      return { date: normaliserDateCsv(date), montant, libelle };
    });
}
