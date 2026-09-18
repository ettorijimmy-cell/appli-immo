import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { UsersService } from "../users/users.service";

export interface AuthenticatedUser {
  id: string;
  email: string;
  organisationId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService
  ) {}

  async validateUser(email: string, password: string): Promise<AuthenticatedUser | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user || user.statut !== "actif") {
      return null;
    }

    const passwordMatches = await argon2.verify(user.motDePasseHash, password);
    if (!passwordMatches) {
      return null;
    }

    return { id: user.id, email: user.email, organisationId: user.organisationId };
  }

  // organisationId résolu ICI, une seule fois au login (utilisateurs.
  // organisationId est NOT NULL — jamais absent) — jamais recalculé à
  // chaque requête. Chantier de mise en conformité du scoping
  // multi-organisation (2026-09-18) : élimine le lookup UsersService.
  // findById() répété que chaque service scopé refaisait pour résoudre
  // organisationId depuis utilisateurId. Invalide toutes les sessions
  // existantes (reconnexion nécessaire) — accepté et voulu.
  async login(user: AuthenticatedUser): Promise<{ accessToken: string }> {
    const payload = { sub: user.id, email: user.email, organisationId: user.organisationId };
    return { accessToken: await this.jwtService.signAsync(payload) };
  }
}
