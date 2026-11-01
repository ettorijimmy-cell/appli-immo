import { isEmail } from "class-validator";

// nodemailer lit le champ `to` comme une liste : une valeur contenant une
// virgule, un point-virgule ou des chevrons viserait plusieurs destinataires
// ou un autre que celui affiché. Refus explicite, en plus du format.
const CARACTERES_INTERDITS = /[,;<>"\s]/;

export function adresseEnvoiValide(adresse: string | null | undefined): adresse is string {
  return typeof adresse === "string" && !CARACTERES_INTERDITS.test(adresse) && isEmail(adresse);
}
