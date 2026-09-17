import { Transform } from "class-transformer";
import { IsEmail, IsString, Length } from "class-validator";

// Un mot de passe d'application Gmail fait exactement 16 caractères,
// affiché par Google en 4 groupes de 4 séparés par des espaces
// ("abcd efgh ijkl mnop") — le vrai secret est la concatenation sans
// espace. Les espaces éventuellement copiés-collés par Jimmy sont retirés
// avant toute validation/chiffrement, jamais stockés tels quels.
export class ConfigurerBoiteMailDedieeDto {
  @IsEmail()
  email!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.replace(/\s+/g, "") : value))
  @IsString()
  @Length(16, 16, { message: "Le mot de passe d'application doit faire exactement 16 caractères (espaces exclus)." })
  motDePasseApp!: string;
}
