const LIMITE_LIGNE = 76;

// Encodage RFC 2047 (En-têtes non-ASCII, ex. objet en français avec
// accents) — base64, jamais un objet tronqué ou mal encodé.
function encoderEnTeteUtf8(valeur: string): string {
  return `=?UTF-8?B?${Buffer.from(valeur, "utf8").toString("base64")}?=`;
}

// RFC 2045 : le contenu base64 d'un corps MIME doit être replié à 76
// caractères par ligne — certains serveurs (dont l'API Gmail) rejettent
// un contenu base64 sur une ligne unique trop longue.
function replierBase64(base64: string): string {
  const lignes: string[] = [];
  for (let i = 0; i < base64.length; i += LIMITE_LIGNE) {
    lignes.push(base64.slice(i, i + LIMITE_LIGNE));
  }
  return lignes.join("\r\n");
}

export interface PieceJointeEmail {
  nomFichier: string;
  contenu: Buffer;
  mimeType: string;
}

export interface MessageEmailInput {
  from: string;
  to: string;
  objet: string;
  corps: string;
  pieceJointe?: PieceJointeEmail;
}

/**
 * Construit un message RFC 2822 complet (jamais via l'API Gmail elle-même,
 * qui attend le message déjà assemblé, encodé en base64url — voir
 * GoogleOAuthService.envoyerEmail). Corps toujours encodé en base64
 * (Content-Transfer-Encoding), jamais en 7bit/8bit brut : garantit un
 * transport correct des accents français, quel que soit le relais SMTP
 * traversé en amont de l'API. Pièce jointe optionnelle : bascule vers
 * multipart/mixed uniquement si présente, jamais un multipart à une seule
 * partie pour un message texte simple.
 */
export function construireMessageRfc2822(input: MessageEmailInput): string {
  const objetEncode = encoderEnTeteUtf8(input.objet);
  const corpsBase64 = replierBase64(Buffer.from(input.corps, "utf8").toString("base64"));

  if (!input.pieceJointe) {
    return [
      `From: ${input.from}`,
      `To: ${input.to}`,
      `Subject: ${objetEncode}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      corpsBase64,
      ""
    ].join("\r\n");
  }

  const boundary = `----appli-immo-${Date.now()}`;
  const pieceJointeBase64 = replierBase64(input.pieceJointe.contenu.toString("base64"));

  return [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${objetEncode}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    corpsBase64,
    "",
    `--${boundary}`,
    `Content-Type: ${input.pieceJointe.mimeType}; name="${input.pieceJointe.nomFichier}"`,
    `Content-Disposition: attachment; filename="${input.pieceJointe.nomFichier}"`,
    "Content-Transfer-Encoding: base64",
    "",
    pieceJointeBase64,
    "",
    `--${boundary}--`,
    ""
  ].join("\r\n");
}
