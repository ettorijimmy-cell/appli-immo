import { IsIn, IsUUID } from "class-validator";

const BAIL_LOCATAIRE_ROLES = ["titulaire", "colocataire"] as const;

export class CreateBailLocataireDto {
  @IsUUID()
  bailId!: string;

  @IsUUID()
  locataireId!: string;

  @IsIn(BAIL_LOCATAIRE_ROLES)
  role!: (typeof BAIL_LOCATAIRE_ROLES)[number];
}
