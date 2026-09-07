import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { DepensesService, type FindAllDepensesFiltres } from "./depenses.service";
import { CreateDepenseDto } from "./dto/create-depense.dto";
import { ParserCsvDepenseDto } from "./dto/parser-csv-depense.dto";

@Controller("depenses")
export class DepensesController {
  constructor(private readonly depensesService: DepensesService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateDepenseDto) {
    return this.depensesService.create(req.user!.sub, dto);
  }

  // Distinct de POST /paiements/rapprocher-csv : ici, purement l'analyse du
  // fichier (aucun rapprochement candidat, aucune écriture) — voir
  // DepensesService.parserCsv.
  @Post("parser-csv")
  parserCsv(@Body() dto: ParserCsvDepenseDto) {
    return this.depensesService.parserCsv(dto.contenuCsv);
  }

  @Get()
  findAll(
    @Query("categorie") categorie?: FindAllDepensesFiltres["categorie"],
    @Query("bienId") bienId?: string,
    @Query("sciId") sciId?: string,
    @Query("dateDebut") dateDebut?: string,
    @Query("dateFin") dateFin?: string
  ) {
    const filtres: FindAllDepensesFiltres = {
      ...(categorie !== undefined && { categorie }),
      ...(bienId !== undefined && { bienId }),
      ...(sciId !== undefined && { sciId }),
      ...(dateDebut !== undefined && { dateDebut }),
      ...(dateFin !== undefined && { dateFin })
    };
    return this.depensesService.findAll(filtres);
  }
}
