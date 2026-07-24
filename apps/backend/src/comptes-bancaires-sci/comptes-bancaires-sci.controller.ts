import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ComptesBancairesSciService } from "./comptes-bancaires-sci.service";
import { CreateCompteBancaireDto } from "./dto/create-compte-bancaire.dto";

@UseGuards(JwtAuthGuard)
@Controller()
export class ComptesBancairesSciController {
  constructor(private readonly comptesBancairesSciService: ComptesBancairesSciService) {}

  @Post("comptes-bancaires-sci")
  create(@Body() dto: CreateCompteBancaireDto) {
    return this.comptesBancairesSciService.create(dto);
  }

  // Seul point d'accès à l'IBAN/BIC en clair — voir CLAUDE.md, section
  // Règles importantes : jamais de déchiffrement côté apps/desktop.
  @Get("scis/:id/comptes-bancaires")
  findForSci(@Param("id") id: string, @Req() req: Request) {
    return this.comptesBancairesSciService.findBySciIdDecrypted(id, req.user!.sub);
  }
}
