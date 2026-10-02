import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
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
  // DepensesService.parserCsv. userId requis pour résoudre l'organisation
  // et charger ses règles de catégorisation (Étape 2).
  @Post("parser-csv")
  parserCsv(@Req() req: Request, @Body() dto: ParserCsvDepenseDto) {
    return this.depensesService.parserCsv(req.user!.sub, dto.contenuCsv);
  }

  @Get()
  findAll(
    @Query("categorie") categorie?: FindAllDepensesFiltres["categorie"],
    @Query("bienId") bienId?: string,
    @Query("sciId") sciId?: string,
    @Query("appartementId") appartementId?: string,
    @Query("dateDebut") dateDebut?: string,
    @Query("dateFin") dateFin?: string
  ) {
    const filtres: FindAllDepensesFiltres = {
      ...(categorie !== undefined && { categorie }),
      ...(bienId !== undefined && { bienId }),
      ...(sciId !== undefined && { sciId }),
      ...(appartementId !== undefined && { appartementId }),
      ...(dateDebut !== undefined && { dateDebut }),
      ...(dateFin !== undefined && { dateFin })
    };
    return this.depensesService.findAll(filtres);
  }

  // Lecture seule — l'aperçu doit être consultable avant toute décision de
  // confirmer (opération irréversible, jamais d'exécution silencieuse côté
  // frontend, voir DepensesListView). Même calcul exact que l'exécution
  // réelle ci-dessous (DepensesService.calculerRepartition, factorisé).
  @Get(":id/apercu-repartition")
  previsualiserRepartition(@Req() req: Request, @Param("id") id: string) {
    return this.depensesService.previsualiserRepartition(id, req.user!.sub);
  }

  @Post(":id/repartir-entre-lots")
  repartirEntreLots(@Req() req: Request, @Param("id") id: string) {
    return this.depensesService.repartirDepenseEntreLots(id, req.user!.sub);
  }
}
