import { Transform } from "class-transformer";
import { ArrayMinSize, IsArray, IsNotEmpty, IsString, IsUUID, MaxLength } from "class-validator";

// Champs texte d'un envoi multipart (le scan arrive à part, champ "scan").
// locataireIds : un même champ répété (multer en fait un tableau, ou une
// chaîne s'il n'y en a qu'un), ou un tableau JSON.
function versTableau({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    if (value.trim().startsWith("[")) {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    }
    return [value];
  }
  return value;
}

export class DeclarerEntreePapierDto {
  // AAAA-MM-JJ, jamais dans le futur : contrôlé par refusDateEntreePapier
  // (core), avec un message en français plutôt que celui de class-validator.
  @IsString()
  @IsNotEmpty()
  dateSignature!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  lieu!: string;

  // Nom du bailleur tel que porté sur le papier (pré-rempli côté desktop,
  // modifiable : mandataire, gérant). Le bailleur signe toujours.
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  bailleurNom!: string;

  // Locataires du bail cochés comme signataires du papier, au moins un.
  @Transform(versTableau)
  @IsArray()
  @ArrayMinSize(1, { message: "Au moins un locataire doit avoir signé l'état des lieux d'entrée papier." })
  @IsUUID("all", { each: true })
  locataireIds!: string[];
}
