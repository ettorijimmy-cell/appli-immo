import { MODES_REMISE_BAIL, type ModeRemiseBail } from "core";
import { IsIn, IsNotEmpty, IsString } from "class-validator";

export class DeclarerRemiseBailDto {
  // AAAA-MM-JJ, jamais dans le futur : contrôlé par refusDateRemiseBail
  // (core), avec un message en français plutôt que celui de class-validator.
  @IsString()
  @IsNotEmpty()
  dateRemise!: string;

  @IsIn(MODES_REMISE_BAIL, { message: "Mode de remise du bail invalide." })
  mode!: ModeRemiseBail;
}
