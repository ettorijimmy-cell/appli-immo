// Module Calendrier d'interventions (2026-09-15). Générateur iCalendar
// (RFC 5545) fait main — aucune bibliothèque ICS dans les dépendances du
// projet, et le sous-ensemble nécessaire ici (VEVENT avec UID/DTSTAMP/
// DTSTART/DTEND/SUMMARY/DESCRIPTION) est un texte structuré simple,
// cohérent avec le refus déjà acté de dépendances pour des besoins
// similaires (recharts pour les graphiques). Flux à sens unique
// (app -> téléphone) : jamais de VTODO, de récurrence (RRULE) ni de
// mise à jour bidirectionnelle.
export interface EvenementIcs {
  id: string;
  titre: string;
  dateDebut: Date;
  // Absente : VEVENT ponctuel sans durée (DTSTART seul, valide au sens
  // RFC 5545) — jamais de durée par défaut inventée.
  dateFin: Date | null;
  notes: string | null;
}

const PRODID = "-//appli-immo//Calendrier//FR";
const LIMITE_OCTETS_LIGNE = 75;

function formaterDateIcs(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// Échappe les caractères spéciaux d'une valeur TEXT (RFC 5545, §3.3.11) —
// backslash, point-virgule, virgule, retour à la ligne.
function echapperTexteIcs(valeur: string): string {
  return valeur.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// Longueur en octets UTF-8 d'un unique code point (calcul arithmétique
// pur, sans TextEncoder/Buffer) — packages/core ne dépend ni du DOM ni de
// Node (tsconfig.json, lib: ["ES2022"], types: []), voir CLAUDE.md :
// "TypeScript pur, sans dépendance Node ni navigateur". Règle UTF-8
// standard : 1 octet jusqu'à U+007F, 2 jusqu'à U+07FF, 3 jusqu'à U+FFFF,
// 4 au-delà (plans supplémentaires, ex. emoji).
function longueurUtf8(caractere: string): number {
  const codePoint = caractere.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

// Repli de ligne à 75 octets (RFC 5545, §3.1) — mesuré en octets UTF-8,
// jamais en caractères (un caractère accentué pèse déjà 2 octets),
// jamais coupé au milieu d'un caractère multi-octets. Chaque ligne de
// continuation commence par un espace, qui consomme 1 des 75 octets
// autorisés sur cette ligne.
function plierLigne(ligne: string): string {
  const segments: string[] = [];
  let segment = "";
  let octets = 0;
  for (const caractere of ligne) {
    const octetsCaractere = longueurUtf8(caractere);
    const limite = segments.length === 0 ? LIMITE_OCTETS_LIGNE : LIMITE_OCTETS_LIGNE - 1;
    if (octets + octetsCaractere > limite) {
      segments.push(segment);
      segment = caractere;
      octets = octetsCaractere;
    } else {
      segment += caractere;
      octets += octetsCaractere;
    }
  }
  segments.push(segment);
  return segments.join("\r\n ");
}

/**
 * Génère un flux iCalendar complet (VCALENDAR) à partir d'une liste
 * d'événements — fonction pure, aucun accès base (les événements sont
 * déjà résolus en paramètre). `maintenant` injectable pour les tests,
 * sinon horodatage réel de génération (DTSTAMP).
 */
export function genererIcs(evenements: EvenementIcs[], maintenant: Date = new Date()): string {
  const dtstamp = formaterDateIcs(maintenant);
  const lignes: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODID}`, "CALSCALE:GREGORIAN"];

  for (const evenement of evenements) {
    lignes.push("BEGIN:VEVENT");
    lignes.push(plierLigne(`UID:${evenement.id}@appli-immo`));
    lignes.push(plierLigne(`DTSTAMP:${dtstamp}`));
    lignes.push(plierLigne(`DTSTART:${formaterDateIcs(evenement.dateDebut)}`));
    if (evenement.dateFin) {
      lignes.push(plierLigne(`DTEND:${formaterDateIcs(evenement.dateFin)}`));
    }
    lignes.push(plierLigne(`SUMMARY:${echapperTexteIcs(evenement.titre)}`));
    if (evenement.notes) {
      lignes.push(plierLigne(`DESCRIPTION:${echapperTexteIcs(evenement.notes)}`));
    }
    lignes.push("END:VEVENT");
  }

  lignes.push("END:VCALENDAR");
  return lignes.join("\r\n") + "\r\n";
}
