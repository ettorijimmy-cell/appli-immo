import { applyDecorators } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { nettoyerTexteObservation } from "core";

// Nettoyage avant validation : la longueur maximale porte sur le texte qui
// sera réellement enregistré. null ou vide efface un champ encore modifiable.
export function TexteObservation(longueurMax: number): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => (typeof value === "string" ? nettoyerTexteObservation(value) : value)),
    IsOptional(),
    IsString(),
    MaxLength(longueurMax)
  );
}
