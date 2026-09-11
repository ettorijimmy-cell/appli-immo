import { IsIn, IsString, MinLength } from "class-validator";
import { DEPENSE_CATEGORIES, type DepenseCategorie } from "../../depenses/depense-categories";

export class CreateRegleCategorisationDto {
  @IsString()
  @MinLength(1)
  motCle!: string;

  @IsIn(DEPENSE_CATEGORIES)
  categorie!: DepenseCategorie;
}
