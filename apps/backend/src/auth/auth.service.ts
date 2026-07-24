import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { UsersService } from "../users/users.service";

export interface AuthenticatedUser {
  id: string;
  email: string;
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

    return { id: user.id, email: user.email };
  }

  async login(user: AuthenticatedUser): Promise<{ accessToken: string }> {
    const payload = { sub: user.id, email: user.email };
    return { accessToken: await this.jwtService.signAsync(payload) };
  }
}
