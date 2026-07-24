import { IsUUID, Matches } from "class-validator";

export class CreateCompteBancaireDto {
  @IsUUID()
  sciId!: string;

  @Matches(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, { message: "IBAN invalide" })
  iban!: string;

  @Matches(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, { message: "BIC invalide" })
  bic!: string;
}
