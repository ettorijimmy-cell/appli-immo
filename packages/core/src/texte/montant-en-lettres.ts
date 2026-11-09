// Montant en toutes lettres, en français (acte de cautionnement, chantier
// garants, 2026-11-08 : plafond, loyer et charges « en chiffres et en
// lettres »). Fonction pure, centimes entiers en entrée, jamais un nombre
// flottant (même principe que montantEnCentimes).
//
// Orthographe rectifiée de 1990 : traits d'union entre tous les numéraux
// d'un nombre, « et » compris (« deux-cent-trente-et-un »,
// « soixante-et-onze »). « million » est un nom, pas un adjectif numéral :
// il prend la marque du pluriel et reste séparé par des espaces
// (« deux millions trois-cent-mille euros »).
//
// Accords :
// - « vingt » (dans quatre-vingts) et « cent » prennent un s quand ils sont
//   multipliés et terminent le nombre (« quatre-vingts », « deux-cents »),
//   jamais quand un autre numéral suit (« quatre-vingt-un »,
//   « deux-cent-un ») ni devant « mille », adjectif numéral invariable
//   (« quatre-vingt-mille », « deux-cent-mille »). Devant « million(s) »,
//   qui est un nom, le s est conservé (« deux-cents millions ») ;
// - « mille » est invariable (« deux-mille ») ;
// - « un » devant « mille » est omis (« mille », jamais « un-mille ») ;
// - « d'euros » après un nombre rond de millions (« un million d'euros »).
//
// Montants pris en charge : de 0 à 999 999 999,99 euros.

const UNITES = [
  "zéro",
  "un",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
  "dix",
  "onze",
  "douze",
  "treize",
  "quatorze",
  "quinze",
  "seize"
];

const DIZAINES: Record<number, string> = {
  2: "vingt",
  3: "trente",
  4: "quarante",
  5: "cinquante",
  6: "soixante"
};

export const MONTANT_EN_LETTRES_MAX_EUROS = 999_999_999;

// 0 à 99. `final` : le nombre termine l'expression (rien ne suit), seul cas
// où « quatre-vingts » prend son s.
function moinsDeCent(n: number, final: boolean): string {
  if (n <= 16) {
    return UNITES[n]!;
  }
  if (n < 20) {
    return `dix-${UNITES[n - 10]!}`;
  }
  const dizaine = Math.floor(n / 10);
  const unite = n % 10;
  if (dizaine <= 6) {
    const base = DIZAINES[dizaine]!;
    if (unite === 0) {
      return base;
    }
    return unite === 1 ? `${base}-et-un` : `${base}-${UNITES[unite]!}`;
  }
  if (dizaine === 7) {
    // 70 à 79 : soixante-dix … soixante-dix-neuf, avec « soixante-et-onze ».
    const reste = n - 60;
    return reste === 11 ? "soixante-et-onze" : `soixante-${moinsDeCent(reste, final)}`;
  }
  // 80 à 99 : quatre-vingt(s), quatre-vingt-un, quatre-vingt-onze (sans « et »).
  const reste = n - 80;
  if (reste === 0) {
    return final ? "quatre-vingts" : "quatre-vingt";
  }
  return `quatre-vingt-${moinsDeCent(reste, final)}`;
}

// 0 à 999 (0 renvoie « zéro », jamais utilisé seul hors du cas zéro euro).
function moinsDeMille(n: number, final: boolean): string {
  const centaines = Math.floor(n / 100);
  const reste = n % 100;
  if (centaines === 0) {
    return moinsDeCent(reste, final);
  }
  const cent = centaines === 1 ? "cent" : `${UNITES[centaines]!}-cent${reste === 0 && final ? "s" : ""}`;
  return reste === 0 ? cent : `${cent}-${moinsDeCent(reste, final)}`;
}

// 0 à 999 999 999, sans l'unité monétaire.
export function nombreEnLettres(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > MONTANT_EN_LETTRES_MAX_EUROS) {
    throw new Error(`Nombre hors des limites de l'écriture en lettres : ${n}`);
  }
  if (n === 0) {
    return "zéro";
  }
  const millions = Math.floor(n / 1_000_000);
  const milliers = Math.floor((n % 1_000_000) / 1000);
  const reste = n % 1000;

  const morceaux: string[] = [];
  if (millions > 0) {
    // « million » est un nom : le s de cent ou de quatre-vingts devant lui
    // est conservé (final = true).
    morceaux.push(`${moinsDeMille(millions, true)} ${millions === 1 ? "million" : "millions"}`);
  }
  // Partie inférieure au million, numéraux liés par des traits d'union.
  const sousMillion: string[] = [];
  if (milliers > 0) {
    // Devant « mille », adjectif numéral : jamais de s à vingt ou à cent.
    sousMillion.push(milliers === 1 ? "mille" : `${moinsDeMille(milliers, false)}-mille`);
  }
  if (reste > 0) {
    sousMillion.push(moinsDeMille(reste, true));
  }
  if (sousMillion.length > 0) {
    morceaux.push(sousMillion.join("-"));
  }
  return morceaux.join(" ");
}

/**
 * Montant en toutes lettres à partir de centimes entiers positifs ou nuls :
 * « zéro euro », « un euro », « deux-cent-trente-et-un euros et
 * cinquante centimes », « cinquante centimes », « un million d'euros ».
 */
export function montantEnLettres(centimes: number): string {
  if (!Number.isInteger(centimes) || centimes < 0) {
    throw new Error(`Montant en centimes invalide : ${centimes}`);
  }
  const euros = Math.floor(centimes / 100);
  const cents = centimes % 100;
  if (euros > MONTANT_EN_LETTRES_MAX_EUROS) {
    throw new Error(`Montant trop élevé pour l'écriture en lettres : ${centimes} centimes`);
  }

  const partieCentimes = cents === 0 ? null : `${nombreEnLettres(cents)} ${cents === 1 ? "centime" : "centimes"}`;
  if (euros === 0) {
    return partieCentimes ?? "zéro euro";
  }
  const unite = euros === 1 ? "euro" : euros % 1_000_000 === 0 ? "d'euros" : "euros";
  const partieEuros = `${nombreEnLettres(euros)} ${unite}`;
  return partieCentimes === null ? partieEuros : `${partieEuros} et ${partieCentimes}`;
}
