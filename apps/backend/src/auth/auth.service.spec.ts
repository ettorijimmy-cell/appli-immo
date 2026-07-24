import type { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";
import type { UsersService } from "../users/users.service";
import { AuthService } from "./auth.service";

function buildService(user: unknown) {
  const usersService = {
    findByEmail: vi.fn().mockResolvedValue(user)
  } as unknown as UsersService;
  const jwtService = {
    signAsync: vi.fn().mockResolvedValue("signed-token")
  } as unknown as JwtService;
  return new AuthService(usersService, jwtService);
}

describe("AuthService.validateUser", () => {
  it("rejette un utilisateur inconnu", async () => {
    const service = buildService(null);
    await expect(service.validateUser("inconnu@example.com", "x")).resolves.toBeNull();
  });

  it("rejette un utilisateur archivé même avec le bon mot de passe", async () => {
    const motDePasseHash = await argon2.hash("bon-mot-de-passe");
    const service = buildService({
      id: "1",
      email: "a@a.com",
      motDePasseHash,
      statut: "archive"
    });
    await expect(service.validateUser("a@a.com", "bon-mot-de-passe")).resolves.toBeNull();
  });

  it("rejette un mauvais mot de passe", async () => {
    const motDePasseHash = await argon2.hash("bon-mot-de-passe");
    const service = buildService({ id: "1", email: "a@a.com", motDePasseHash, statut: "actif" });
    await expect(service.validateUser("a@a.com", "mauvais")).resolves.toBeNull();
  });

  it("valide un utilisateur actif avec le bon mot de passe", async () => {
    const motDePasseHash = await argon2.hash("bon-mot-de-passe");
    const service = buildService({ id: "1", email: "a@a.com", motDePasseHash, statut: "actif" });
    await expect(service.validateUser("a@a.com", "bon-mot-de-passe")).resolves.toEqual({
      id: "1",
      email: "a@a.com"
    });
  });
});
