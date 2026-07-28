import { IsInt, Min } from "class-validator";

export class UpdateSeuilAlerteDto {
  @IsInt()
  @Min(0)
  seuilJoursAvant!: number;
}
