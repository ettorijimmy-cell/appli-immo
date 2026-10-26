import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { SignerEtatDesLieuxDto } from "./dto/signer-etat-des-lieux.dto";
import { EtatsDesLieuxSignatureService } from "./etats-des-lieux-signature.service";

@Controller("etats-des-lieux")
export class EtatsDesLieuxSignatureController {
  constructor(private readonly etatsDesLieuxSignatureService: EtatsDesLieuxSignatureService) {}

  // Mobile-web, écran de signature : bailleur pré-rempli + locataires
  // actifs, avant même d'afficher les cartes signataires.
  @Get(":id/signataires")
  obtenirSignataires(@Param("id") id: string) {
    return this.etatsDesLieuxSignatureService.obtenirSignatairesAttendus(id);
  }

  // Relecture desktop (SignaturesCard) : signatures déjà posées, toutes
  // phases confondues.
  @Get(":id/signatures")
  obtenirSignaturesPosees(@Param("id") id: string) {
    return this.etatsDesLieuxSignatureService.obtenirSignaturesPosees(id);
  }

  @Post(":id/signer-entree")
  signerEntree(@Param("id") id: string, @Body() dto: SignerEtatDesLieuxDto) {
    return this.etatsDesLieuxSignatureService.signerEntree(id, dto);
  }

  @Post(":id/signer-sortie")
  signerSortie(@Param("id") id: string, @Body() dto: SignerEtatDesLieuxDto) {
    return this.etatsDesLieuxSignatureService.signerSortie(id, dto);
  }
}
