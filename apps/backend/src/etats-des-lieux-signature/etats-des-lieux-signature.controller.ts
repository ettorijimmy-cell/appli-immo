import { Body, Controller, Param, Post } from "@nestjs/common";
import { SignerEtatDesLieuxDto } from "./dto/signer-etat-des-lieux.dto";
import { EtatsDesLieuxSignatureService } from "./etats-des-lieux-signature.service";

@Controller("etats-des-lieux")
export class EtatsDesLieuxSignatureController {
  constructor(private readonly etatsDesLieuxSignatureService: EtatsDesLieuxSignatureService) {}

  @Post(":id/signer-entree")
  signerEntree(@Param("id") id: string, @Body() dto: SignerEtatDesLieuxDto) {
    return this.etatsDesLieuxSignatureService.signerEntree(id, dto);
  }

  @Post(":id/signer-sortie")
  signerSortie(@Param("id") id: string, @Body() dto: SignerEtatDesLieuxDto) {
    return this.etatsDesLieuxSignatureService.signerSortie(id, dto);
  }
}
