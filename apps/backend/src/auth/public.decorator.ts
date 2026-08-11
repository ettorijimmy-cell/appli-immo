import { SetMetadata } from "@nestjs/common";

// Utilisé par JwtAuthGuard (garde globale, voir auth.module.ts) pour
// identifier les routes volontairement ouvertes — échec sécurisé par
// défaut : toute route SANS ce décorateur exige un JWT valide.
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
