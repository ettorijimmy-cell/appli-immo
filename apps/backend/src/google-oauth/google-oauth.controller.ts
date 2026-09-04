import { BadRequestException, Controller, Get, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../auth/public.decorator";
import { GoogleOAuthService } from "./google-oauth.service";

@Controller("gmail")
export class GoogleOAuthController {
  constructor(private readonly googleOAuthService: GoogleOAuthService) {}

  @Get("url-consentement")
  async urlConsentement(@Req() req: Request): Promise<{ url: string }> {
    const url = await this.googleOAuthService.genererUrlConsentement(req.user!.sub);
    return { url };
  }

  @Get("statut")
  async statut(@Req() req: Request) {
    return this.googleOAuthService.obtenirStatut(req.user!.sub);
  }

  // @Public() : Google redirige le navigateur système de l'utilisateur
  // directement ici — aucun JWT applicatif ne peut être transmis (voir
  // audit préalable, docs/data-dictionary.md, section Authentification).
  // Deuxième précédent après POST /auth/login. La protection réelle contre
  // le CSRF passe par la signature/fraîcheur du state (JwtService),
  // vérifiée dans GoogleOAuthService.traiterCallback — jamais par la
  // garde JWT elle-même.
  @Public()
  @Get("callback")
  async callback(@Query("code") code: string, @Query("state") state: string, @Res() res: Response): Promise<void> {
    if (!code || !state) {
      throw new BadRequestException("Paramètres code/state manquants.");
    }
    const { emailCompte } = await this.googleOAuthService.traiterCallback(code, state);
    res.set({ "Content-Type": "text/html; charset=utf-8" });
    res.send(pageConfirmation(emailCompte));
  }
}

// Page minimale, aucune redirection vers l'application desktop (impossible
// depuis un navigateur système générique) — l'utilisateur ferme l'onglet
// manuellement, l'écran Paramètres reflète l'état à sa prochaine ouverture
// (GET /gmail/statut).
function pageConfirmation(emailCompte: string): string {
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Connexion Gmail</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 4rem;">
  <h1>Connexion réussie</h1>
  <p>Compte connecté : ${escapeHtml(emailCompte)}</p>
  <p>Vous pouvez fermer cette fenêtre.</p>
</body>
</html>`;
}

function escapeHtml(valeur: string): string {
  return valeur.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
