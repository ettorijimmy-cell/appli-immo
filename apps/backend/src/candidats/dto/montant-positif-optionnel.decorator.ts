import { applyDecorators } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsOptional, Matches } from "class-validator";
import { normaliserMontant } from "core";

// Montants candidat (revenu/loyer visé/revenu garant) : même règle que
// CreateDepenseDto.montant (normaliserMontant + @Matches positif), mais
// facultatifs — un candidat peut être créé sans ces informations et les
// compléter plus tard.
export function MontantPositifOptionnel() {
  return applyDecorators(
    IsOptional(),
    Transform(({ value }: { value: unknown }) => (typeof value === "string" ? normaliserMontant(value) : value)),
    Matches(/^\d+(\.\d+)?$/, { message: "doit être un nombre positif" })
  );
}
