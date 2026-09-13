import { IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";

const TYPES_ENTITE = ["personne_physique", "entreprise"] as const;
const ROLES = ["artisan", "diagnostiqueur", "syndic", "assureur", "autre"] as const;

export class CreateContactDto {
  @IsString()
  @MinLength(1)
  nom!: string;

  @IsIn(TYPES_ENTITE)
  typeEntite!: (typeof TYPES_ENTITE)[number];

  @IsIn(ROLES)
  role!: (typeof ROLES)[number];

  @IsOptional()
  @IsString()
  telephone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
