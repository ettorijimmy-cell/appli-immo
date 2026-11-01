import PizZip from "pizzip";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { corrigerMediasJpeg, reencoderPhotoPourDocument } from "./medias-photo-document";

const ROUGE = { r: 255, g: 0, b: 0 };
const BLEU = { r: 0, g: 0, b: 255 };

// Image 40×20 : moitié gauche rouge, moitié droite bleue. Permet de vérifier
// le sens réel des pixels, pas seulement les dimensions.
async function pixelsDeuxCouleurs(): Promise<ReturnType<typeof sharp>> {
  const moitie = await sharp({ create: { width: 20, height: 20, channels: 3, background: BLEU } }).png().toBuffer();
  return sharp({ create: { width: 40, height: 20, channels: 3, background: ROUGE } }).composite([
    { input: moitie, left: 20, top: 0 }
  ]);
}

// La latitude 48/1 telle que stockée dans l'EXIF : deux entiers binaires
// petit-boutistes, jamais un texte recherchable.
function contientLatitudeGps(image: Buffer): boolean {
  const rationnel = Buffer.alloc(8);
  rationnel.writeUInt32LE(48, 0);
  rationnel.writeUInt32LE(1, 4);
  return image.includes(rationnel);
}

async function jpegDeTelephone(orientation: number): Promise<Buffer> {
  return (await pixelsDeuxCouleurs())
    .withExif({
      IFD0: { Make: "MarqueTelephoneTest", Model: "ModeleTest" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 24/1", GPSLongitudeRef: "E", GPSLongitude: "2/1 21/1 3/1" }
    })
    .withMetadata({ orientation })
    .jpeg({ quality: 100 })
    .toBuffer();
}

async function couleurPixel(image: Buffer, x: number, y: number): Promise<"rouge" | "bleu"> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const decalage = (y * info.width + x) * info.channels;
  return (data[decalage] ?? 0) > (data[decalage + 2] ?? 0) ? "rouge" : "bleu";
}

function zipAvecMedias(medias: Record<string, Buffer>): PizZip {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="x"><Default Extension="png" ContentType="image/png"/></Types>'
  );
  const relations = Object.keys(medias)
    .map((nom, rang) => `<Relationship Id="rId${rang}" Type="image" Target="${nom.replace("word/", "")}"/>`)
    .join("");
  zip.file("word/_rels/document.xml.rels", `<Relationships>${relations}</Relationships>`);
  for (const [nom, contenu] of Object.entries(medias)) {
    zip.file(nom, contenu);
  }
  return zip;
}

describe("reencoderPhotoPourDocument", () => {
  it("le test part bien d'un JPEG portant EXIF, GPS et orientation", async () => {
    const source = await jpegDeTelephone(6);
    const meta = await sharp(source).metadata();

    expect(meta.format).toBe("jpeg");
    expect(meta.orientation).toBe(6);
    expect(meta.exif).toBeDefined();
    expect(source.includes("MarqueTelephoneTest")).toBe(true);
    expect(contientLatitudeGps(source)).toBe(true);
  });

  it("produit un JPEG sans aucune métadonnée (EXIF, GPS, XMP, IPTC, ICC)", async () => {
    const sortie = await reencoderPhotoPourDocument(await jpegDeTelephone(6));
    const meta = await sharp(sortie).metadata();

    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(sortie.includes("Exif")).toBe(false);
    expect(sortie.includes("MarqueTelephoneTest")).toBe(false);
    expect(contientLatitudeGps(sortie)).toBe(false);
  });

  it("orientation 6 (90° horaire) : dimensions inversées, rouge en haut, bleu en bas", async () => {
    const sortie = await reencoderPhotoPourDocument(await jpegDeTelephone(6));
    const meta = await sharp(sortie).metadata();

    expect([meta.width, meta.height]).toEqual([20, 40]);
    expect(await couleurPixel(sortie, 10, 5)).toBe("rouge");
    expect(await couleurPixel(sortie, 10, 35)).toBe("bleu");
  });

  it("orientation 8 (90° antihoraire) : bleu en haut, rouge en bas", async () => {
    const sortie = await reencoderPhotoPourDocument(await jpegDeTelephone(8));

    expect(await couleurPixel(sortie, 10, 5)).toBe("bleu");
    expect(await couleurPixel(sortie, 10, 35)).toBe("rouge");
  });

  it("orientation 3 (180°) : bleu à gauche, rouge à droite", async () => {
    const sortie = await reencoderPhotoPourDocument(await jpegDeTelephone(3));

    expect(await couleurPixel(sortie, 5, 10)).toBe("bleu");
    expect(await couleurPixel(sortie, 35, 10)).toBe("rouge");
  });

  it("orientation 1 : aucun changement de sens", async () => {
    const sortie = await reencoderPhotoPourDocument(await jpegDeTelephone(1));

    expect(await couleurPixel(sortie, 5, 10)).toBe("rouge");
    expect(await couleurPixel(sortie, 35, 10)).toBe("bleu");
  });

  it("ramène la largeur à 1600 px en gardant les proportions", async () => {
    const grande = await sharp({ create: { width: 3200, height: 2400, channels: 3, background: ROUGE } })
      .jpeg()
      .toBuffer();

    const meta = await sharp(await reencoderPhotoPourDocument(grande)).metadata();

    expect([meta.width, meta.height]).toEqual([1600, 1200]);
  });

  it("ne réagrandit jamais une petite photo", async () => {
    const petite = await sharp({ create: { width: 200, height: 100, channels: 3, background: ROUGE } })
      .jpeg()
      .toBuffer();

    const meta = await sharp(await reencoderPhotoPourDocument(petite)).metadata();

    expect([meta.width, meta.height]).toEqual([200, 100]);
  });

  it("une zone transparente devient blanche, jamais noire", async () => {
    const transparente = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .png()
      .toBuffer();

    const sortie = await reencoderPhotoPourDocument(transparente);
    const { data } = await sharp(sortie).raw().toBuffer({ resolveWithObject: true });

    expect(data[0]).toBeGreaterThan(250);
  });
});

describe("corrigerMediasJpeg", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);

  it("renomme le JPEG, garde le contenu, met à jour relation et type", () => {
    const zip = zipAvecMedias({ "word/media/image_generated_1.png": jpeg });

    corrigerMediasJpeg(zip);

    expect(zip.file("word/media/image_generated_1.png")).toBeNull();
    expect(zip.file("word/media/image_generated_1.jpg")?.asNodeBuffer().equals(jpeg)).toBe(true);
    const relations = zip.file("word/_rels/document.xml.rels")?.asText();
    expect(relations).toContain('Target="media/image_generated_1.jpg"');
    expect(relations).not.toContain("image_generated_1.png");
    expect(zip.file("[Content_Types].xml")?.asText()).toContain('<Default Extension="jpg" ContentType="image/jpeg"/>');
  });

  it("laisse intacte une signature PNG dans le même document", () => {
    const zip = zipAvecMedias({
      "word/media/image_generated_1.png": jpeg,
      "word/media/image_generated_2.png": png
    });

    corrigerMediasJpeg(zip);

    expect(zip.file("word/media/image_generated_2.png")?.asNodeBuffer().equals(png)).toBe(true);
    const relations = zip.file("word/_rels/document.xml.rels")?.asText();
    expect(relations).toContain('Target="media/image_generated_1.jpg"');
    expect(relations).toContain('Target="media/image_generated_2.png"');
  });

  it("ne confond pas image_generated_1 et image_generated_10", () => {
    const zip = zipAvecMedias({
      "word/media/image_generated_1.png": jpeg,
      "word/media/image_generated_10.png": png
    });

    corrigerMediasJpeg(zip);

    const relations = zip.file("word/_rels/document.xml.rels")?.asText();
    expect(relations).toContain('Target="media/image_generated_1.jpg"');
    expect(relations).toContain('Target="media/image_generated_10.png"');
  });

  it("ne déclare jamais deux fois le type jpg", () => {
    const zip = zipAvecMedias({ "word/media/image_generated_1.png": jpeg });
    zip.file(
      "[Content_Types].xml",
      '<Types xmlns="x"><Default Extension="jpg" ContentType="image/jpeg"/></Types>'
    );

    corrigerMediasJpeg(zip);

    expect(zip.file("[Content_Types].xml")?.asText().match(/Extension="jpg"/g)).toHaveLength(1);
  });

  it("sans JPEG, ne change rien", () => {
    const zip = zipAvecMedias({ "word/media/image_generated_1.png": png });
    const types = zip.file("[Content_Types].xml")?.asText();

    corrigerMediasJpeg(zip);

    expect(zip.file("[Content_Types].xml")?.asText()).toBe(types);
    expect(zip.file("word/media/image_generated_1.png")).not.toBeNull();
  });

  it("ne touche pas aux médias d'origine du modèle", () => {
    const zip = zipAvecMedias({ "word/media/image1.png": jpeg });

    corrigerMediasJpeg(zip);

    expect(zip.file("word/media/image1.png")).not.toBeNull();
  });
});
