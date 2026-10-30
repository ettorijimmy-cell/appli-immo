import { Module } from "@nestjs/common";
import { BienModule } from "../bien/bien.module";
import { EtatDesLieuxPdfModule } from "../etat-des-lieux-pdf/etat-des-lieux-pdf.module";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { OrganisationResolutionModule } from "../organisation-resolution/organisation-resolution.module";
import { StorageModule } from "../storage/storage.module";
import { EtatsDesLieuxSignatureController } from "./etats-des-lieux-signature.controller";
import { EtatsDesLieuxSignatureService } from "./etats-des-lieux-signature.service";

@Module({
  imports: [StorageModule, EtatsDesLieuxModule, OrganisationResolutionModule, BienModule, EtatDesLieuxPdfModule],
  controllers: [EtatsDesLieuxSignatureController],
  providers: [EtatsDesLieuxSignatureService]
})
export class EtatsDesLieuxSignatureModule {}
