import type PizZip from "pizzip";
import sharp from "sharp";

const LARGEUR_MAX_PHOTO_PX = 1600;
const QUALITE_JPEG_PHOTO = 80;
const NOM_MEDIA_GENERE = /^word\/media\/image_generated_\d+\.png$/;
const RELATIONS_WORD = /^word\/_rels\/[^/]+\.rels$/;
const TYPES_CONTENU = "[Content_Types].xml";
const SIGNATURE_JPEG = [0xff, 0xd8, 0xff];

// Une photo d'état des lieux n'entre dans le document qu'après ce passage :
// - rotate() sans argument applique l'orientation EXIF aux pixels, seule
//   façon d'obtenir le bon sens partout (Word et LibreOffice ne l'appliquent
//   pas de façon fiable) ;
// - aucun appel à withMetadata/keepMetadata : sharp retire alors toutes les
//   métadonnées (EXIF, GPS, XMP, profil ICC), exigence de confidentialité
//   sur des photos prises au téléphone ;
// - flatten : le JPEG n'a pas de transparence, un PNG transparent virerait
//   au noir sans ce fond blanc.
export function reencoderPhotoPourDocument(contenu: Buffer): Promise<Buffer> {
  return sharp(contenu)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: LARGEUR_MAX_PHOTO_PX, withoutEnlargement: true })
    .jpeg({ quality: QUALITE_JPEG_PHOTO, mozjpeg: true })
    .toBuffer();
}

function estJpeg(contenu: Buffer): boolean {
  return SIGNATURE_JPEG.every((octet, rang) => contenu[rang] === octet);
}

// docxtemplater-image-module-free nomme tout média image_generated_N.png,
// quel que soit son contenu (docs/backlog.md, "Bug confirmé du module") :
// un JPEG serait déclaré image/png dans le paquet Word. Corrigé après le
// rendu, dans le paquet lui-même, plutôt qu'en surchargeant une méthode
// interne du module. Les signatures, de vrais PNG, ne sont pas touchées.
export function corrigerMediasJpeg(zip: PizZip): void {
  const medias = Object.keys(zip.files).filter((nom) => NOM_MEDIA_GENERE.test(nom));
  const renommes: { ancien: string; nouveau: string }[] = [];

  for (const ancien of medias) {
    const contenu = zip.file(ancien)?.asNodeBuffer();
    if (!contenu || !estJpeg(contenu)) {
      continue;
    }
    const nouveau = ancien.replace(/\.png$/, ".jpg");
    zip.file(nouveau, contenu);
    zip.remove(ancien);
    renommes.push({ ancien: ancien.replace("word/", ""), nouveau: nouveau.replace("word/", "") });
  }
  if (renommes.length === 0) {
    return;
  }

  for (const nom of Object.keys(zip.files).filter((n) => RELATIONS_WORD.test(n))) {
    let relations = zip.file(nom)?.asText() ?? "";
    for (const { ancien, nouveau } of renommes) {
      relations = relations.split(`"${ancien}"`).join(`"${nouveau}"`);
    }
    zip.file(nom, relations);
  }

  const types = zip.file(TYPES_CONTENU)?.asText();
  if (types && !/Extension="jpg"/i.test(types)) {
    zip.file(TYPES_CONTENU, types.replace("</Types>", '<Default Extension="jpg" ContentType="image/jpeg"/></Types>'));
  }
}
