import { BadRequestException } from "@nestjs/common";

// 512 Ko — bien plus restrictif que la limite générique de /documents
// (TAILLE_MAX_OCTETS, 20 Mo, pensée pour des photos/scans) : un PNG de
// signature tactile (signature_pad, trait fin sur fond uni) pèse
// normalement quelques dizaines de Ko (voir docs/data-dictionary.md,
// section etat_des_lieux_signature).
export const TAILLE_MAX_IMAGE_SIGNATURE_OCTETS = 512 * 1024;

// Huit premiers octets de tout fichier PNG valide (spécification PNG,
// chunk IHDR précédé de cette signature fixe) — vérifié sur le contenu
// réel, jamais sur un mime-type déclaré (non fourni par le client ici,
// seulement une chaîne base64).
const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// `contexte` identifie le signataire dans le message d'erreur (ex. "le
// bailleur", "Jean Dupont") — jamais le document/état des lieux lui-même,
// pour que l'erreur reste exploitable côté mobile sans jointure
// supplémentaire. La validité syntaxique du base64 est déjà garantie en
// amont par @IsBase64() sur le DTO (ValidationPipe globale) : cette
// fonction ne revalide que le CONTENU décodé (taille, format réel).
export function decoderEtValiderImageSignature(imageBase64: string, contexte: string): Buffer {
  const buffer = Buffer.from(imageBase64, "base64");
  if (buffer.length === 0) {
    throw new BadRequestException(`Image de signature invalide pour ${contexte} : contenu vide.`);
  }
  if (buffer.length > TAILLE_MAX_IMAGE_SIGNATURE_OCTETS) {
    throw new BadRequestException(
      `Image de signature trop volumineuse pour ${contexte} : ${buffer.length} octets (maximum ${TAILLE_MAX_IMAGE_SIGNATURE_OCTETS}).`
    );
  }
  if (buffer.length < SIGNATURE_PNG.length || !buffer.subarray(0, SIGNATURE_PNG.length).equals(SIGNATURE_PNG)) {
    throw new BadRequestException(`Image de signature invalide pour ${contexte} : seul le format PNG est accepté.`);
  }
  return buffer;
}
