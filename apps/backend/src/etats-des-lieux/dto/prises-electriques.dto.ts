import { IsInt, IsOptional, Min } from "class-validator";
import { EtatElementDto } from "./etat-element.dto";

// "Prises électriques (nombre)" — le seul élément du modèle réel qui
// porte, en plus de l'état, un comptage physique non doublé entrée/sortie
// (le nombre de prises ne change pas entre l'entrée et la sortie).
export class PrisesElectriquesDto extends EtatElementDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  nombre?: number;
}
