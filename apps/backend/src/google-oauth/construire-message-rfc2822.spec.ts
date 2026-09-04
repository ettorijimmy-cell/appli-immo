import { describe, expect, it } from "vitest";
import { construireMessageRfc2822 } from "./construire-message-rfc2822";

// Pas de dépendance base/réseau : construireMessageRfc2822 est une fonction
// pure (Buffer mis à part) — pas de mock à mettre en place, contrairement à
// GoogleOAuthService (voir google-oauth.service.spec.ts, fetch mocké).
describe("construireMessageRfc2822", () => {
  it("encode l'objet en RFC 2047 (UTF-8 base64) pour préserver les accents", () => {
    const message = construireMessageRfc2822({
      from: "proprietaire@example.com",
      to: "locataire@example.com",
      objet: "Révision de votre loyer — Été 2026",
      corps: "Bonjour."
    });

    const ligneObjet = message.split("\r\n").find((ligne) => ligne.startsWith("Subject:"));
    expect(ligneObjet).toBe(
      `Subject: =?UTF-8?B?${Buffer.from("Révision de votre loyer — Été 2026", "utf8").toString("base64")}?=`
    );
  });

  it("encode toujours le corps en base64 (jamais 7bit/8bit brut), même sans accent", () => {
    const message = construireMessageRfc2822({
      from: "proprietaire@example.com",
      to: "locataire@example.com",
      objet: "Sujet simple",
      corps: "Corps simple sans accent."
    });

    expect(message).toContain("Content-Transfer-Encoding: base64");
    const corpsAttendu = Buffer.from("Corps simple sans accent.", "utf8").toString("base64");
    expect(message).toContain(corpsAttendu);
  });

  it("replie le corps base64 à 76 caractères par ligne (RFC 2045)", () => {
    // Corps volontairement long pour produire un base64 de plusieurs lignes.
    const corpsLong = "Bonjour, ".repeat(50);
    const message = construireMessageRfc2822({
      from: "proprietaire@example.com",
      to: "locataire@example.com",
      objet: "Sujet",
      corps: corpsLong
    });

    const base64Attendu = Buffer.from(corpsLong, "utf8").toString("base64");
    const lignesAttendues: string[] = [];
    for (let i = 0; i < base64Attendu.length; i += 76) {
      lignesAttendues.push(base64Attendu.slice(i, i + 76));
    }
    expect(lignesAttendues.length).toBeGreaterThan(1);
    for (const ligne of lignesAttendues) {
      expect(message).toContain(ligne);
    }
    for (const ligne of message.split("\r\n")) {
      expect(ligne.length).toBeLessThanOrEqual(76);
    }
  });

  it("reste en text/plain simple (sans multipart) quand aucune pièce jointe n'est fournie", () => {
    const message = construireMessageRfc2822({
      from: "proprietaire@example.com",
      to: "locataire@example.com",
      objet: "Sujet",
      corps: "Corps."
    });

    expect(message).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(message).not.toContain("multipart/mixed");
  });

  it("bascule en multipart/mixed uniquement quand une pièce jointe est fournie", () => {
    const message = construireMessageRfc2822({
      from: "proprietaire@example.com",
      to: "locataire@example.com",
      objet: "Quittance de loyer",
      corps: "Voir pièce jointe.",
      pieceJointe: {
        nomFichier: "quittance-janvier.docx",
        contenu: Buffer.from("contenu-binaire-factice"),
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      }
    });

    expect(message).toContain("multipart/mixed");
    expect(message).toContain('Content-Disposition: attachment; filename="quittance-janvier.docx"');
    expect(message).toContain(
      "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    const pieceJointeBase64 = Buffer.from("contenu-binaire-factice").toString("base64");
    expect(message).toContain(pieceJointeBase64);
  });
});
