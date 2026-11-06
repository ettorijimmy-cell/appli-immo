import { Module } from "@nestjs/common";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { OrganisationResolutionModule } from "../organisation-resolution/organisation-resolution.module";
import { StorageModule } from "../storage/storage.module";
import { EtatDesLieuxEntreePapierController } from "./etat-des-lieux-entree-papier.controller";
import { EtatDesLieuxEntreePapierService } from "./etat-des-lieux-entree-papier.service";

@Module({
  imports: [StorageModule, EtatsDesLieuxModule, OrganisationResolutionModule],
  controllers: [EtatDesLieuxEntreePapierController],
  providers: [EtatDesLieuxEntreePapierService]
})
export class EtatDesLieuxEntreePapierModule {}
