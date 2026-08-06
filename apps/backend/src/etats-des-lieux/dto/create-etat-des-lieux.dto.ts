import { IsUUID } from "class-validator";

export class CreateEtatDesLieuxDto {
  @IsUUID()
  bailId!: string;
}
