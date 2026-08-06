import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateEtatDesLieuxDto } from "./dto/create-etat-des-lieux.dto";
import { SubmitClesDto } from "./dto/submit-cles.dto";
import { SubmitCompteursDto } from "./dto/submit-compteurs.dto";
import { SubmitEquipementsDiversDto } from "./dto/submit-equipements-divers.dto";
import { SubmitInventaireDto } from "./dto/submit-inventaire.dto";
import { SubmitPieceAutreDto } from "./dto/submit-piece-autre.dto";
import { SubmitPieceChambreDto } from "./dto/submit-piece-chambre.dto";
import { SubmitPieceCuisineDto } from "./dto/submit-piece-cuisine.dto";
import { SubmitPieceEntreeDto } from "./dto/submit-piece-entree.dto";
import { SubmitPieceSalleDeBainDto } from "./dto/submit-piece-salle-de-bain.dto";
import { SubmitPieceSejourDto } from "./dto/submit-piece-sejour.dto";
import { SubmitPieceWcDto } from "./dto/submit-piece-wc.dto";
import { UpdateEtatDesLieuxDto } from "./dto/update-etat-des-lieux.dto";
import { EtatsDesLieuxService } from "./etats-des-lieux.service";

@UseGuards(JwtAuthGuard)
@Controller("etats-des-lieux")
export class EtatsDesLieuxController {
  constructor(private readonly etatsDesLieuxService: EtatsDesLieuxService) {}

  @Post()
  create(@Body() dto: CreateEtatDesLieuxDto) {
    return this.etatsDesLieuxService.create(dto);
  }

  @Get()
  findByBailId(@Query("bailId") bailId: string, @Query("avecArchives") avecArchives?: string) {
    return this.etatsDesLieuxService.findByBailId(bailId, avecArchives === "true");
  }

  // Route littérale déclarée avant ":id" — sinon NestJS la capturerait
  // comme un id. Catalogue de référence pour l'inventaire meublé (88
  // lignes), consommé par la vue de relecture desktop et par le parcours
  // de capture mobile (étape inventaire).
  @Get("catalogue-inventaire")
  getCatalogueInventaire() {
    return this.etatsDesLieuxService.getCatalogueInventaire();
  }

  @Get(":id")
  findOne(@Param("id") id: string, @Query("avecArchives") avecArchives?: string) {
    return this.etatsDesLieuxService.findById(id, avecArchives === "true");
  }

  @Patch(":id")
  updateHeader(@Param("id") id: string, @Body() dto: UpdateEtatDesLieuxDto) {
    return this.etatsDesLieuxService.updateHeader(id, dto);
  }

  // Un endpoint par pièce (résilience réseau du parcours mobile) : chaque
  // soumission est indépendante, sans file d'attente de synchronisation.
  @Patch(":id/piece-entree")
  submitPieceEntree(@Param("id") id: string, @Body() dto: SubmitPieceEntreeDto) {
    return this.etatsDesLieuxService.submitPieceEntree(id, dto);
  }

  @Patch(":id/piece-sejour")
  submitPieceSejour(@Param("id") id: string, @Body() dto: SubmitPieceSejourDto) {
    return this.etatsDesLieuxService.submitPieceSejour(id, dto);
  }

  @Patch(":id/piece-cuisine")
  submitPieceCuisine(@Param("id") id: string, @Body() dto: SubmitPieceCuisineDto) {
    return this.etatsDesLieuxService.submitPieceCuisine(id, dto);
  }

  @Patch(":id/piece-chambre")
  submitPieceChambre(@Param("id") id: string, @Body() dto: SubmitPieceChambreDto) {
    return this.etatsDesLieuxService.submitPieceChambre(id, dto);
  }

  @Patch(":id/piece-salle-de-bain")
  submitPieceSalleDeBain(@Param("id") id: string, @Body() dto: SubmitPieceSalleDeBainDto) {
    return this.etatsDesLieuxService.submitPieceSalleDeBain(id, dto);
  }

  @Patch(":id/piece-wc")
  submitPieceWc(@Param("id") id: string, @Body() dto: SubmitPieceWcDto) {
    return this.etatsDesLieuxService.submitPieceWc(id, dto);
  }

  @Patch(":id/piece-autre")
  submitPieceAutre(@Param("id") id: string, @Body() dto: SubmitPieceAutreDto) {
    return this.etatsDesLieuxService.submitPieceAutre(id, dto);
  }

  @Patch(":id/compteurs")
  submitCompteurs(@Param("id") id: string, @Body() dto: SubmitCompteursDto) {
    return this.etatsDesLieuxService.submitCompteurs(id, dto);
  }

  // Upsert par id explicite (voir EtatsDesLieuxService.upsertEtArchiverParId)
  // — jamais un remplacement en bloc, pour ne pas perdre silencieusement
  // les valeurs d'entrée à une soumission de sortie qui ne renverrait pas
  // toute la liste.
  @Patch(":id/cles")
  submitCles(@Param("id") id: string, @Body() dto: SubmitClesDto) {
    return this.etatsDesLieuxService.submitCles(id, dto);
  }

  @Patch(":id/equipements-divers")
  submitEquipementsDivers(@Param("id") id: string, @Body() dto: SubmitEquipementsDiversDto) {
    return this.etatsDesLieuxService.submitEquipementsDivers(id, dto);
  }

  @Patch(":id/inventaire")
  submitInventaire(@Param("id") id: string, @Body() dto: SubmitInventaireDto) {
    return this.etatsDesLieuxService.submitInventaire(id, dto);
  }
}
