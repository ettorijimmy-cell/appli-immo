import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppartementsModule } from "./appartements/appartements.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { BailLocatairesModule } from "./bail-locataires/bail-locataires.module";
import { BauxModule } from "./baux/baux.module";
import { CommonModule } from "./common/common.module";
import { ComptesBancairesSciModule } from "./comptes-bancaires-sci/comptes-bancaires-sci.module";
import { EncryptionModule } from "./crypto/encryption.module";
import { DatabaseModule } from "./database/database.module";
import { DocumentsModule } from "./documents/documents.module";
import { EquipementsModule } from "./equipements/equipements.module";
import { GarantsModule } from "./garants/garants.module";
import { ImmeublesModule } from "./immeubles/immeubles.module";
import { LocatairesModule } from "./locataires/locataires.module";
import { PaiementsModule } from "./paiements/paiements.module";
import { ScisModule } from "./scis/scis.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    DatabaseModule,
    EncryptionModule,
    AuditModule,
    AuthModule,
    ScisModule,
    ComptesBancairesSciModule,
    ImmeublesModule,
    AppartementsModule,
    EquipementsModule,
    LocatairesModule,
    BauxModule,
    GarantsModule,
    BailLocatairesModule,
    PaiementsModule,
    DocumentsModule
  ]
})
export class AppModule {}
