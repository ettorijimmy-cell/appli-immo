import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AlertesModule } from "./alertes/alertes.module";
import { AppartementsModule } from "./appartements/appartements.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { BailDocumentDocxModule } from "./bail-document-docx/bail-document-docx.module";
import { BailLocatairesModule } from "./bail-locataires/bail-locataires.module";
import { BauxModule } from "./baux/baux.module";
import { CommonModule } from "./common/common.module";
import { ComptesBancairesSciModule } from "./comptes-bancaires-sci/comptes-bancaires-sci.module";
import { EncryptionModule } from "./crypto/encryption.module";
import { DatabaseModule } from "./database/database.module";
import { DocumentsModule } from "./documents/documents.module";
import { EquipementsModule } from "./equipements/equipements.module";
import { EtatDesLieuxDocumentDocxModule } from "./etat-des-lieux-document-docx/etat-des-lieux-document-docx.module";
import { EtatsDesLieuxModule } from "./etats-des-lieux/etats-des-lieux.module";
import { GarantsModule } from "./garants/garants.module";
import { ImmeublesModule } from "./immeubles/immeubles.module";
import { IndicesIrlModule } from "./indices-irl/indices-irl.module";
import { LocatairesModule } from "./locataires/locataires.module";
import { PaiementsModule } from "./paiements/paiements.module";
import { RemboursementsModule } from "./remboursements/remboursements.module";
import { ScisModule } from "./scis/scis.module";
import { TableauDeBordModule } from "./tableau-de-bord/tableau-de-bord.module";
import { VersementsModule } from "./versements/versements.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
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
    VersementsModule,
    RemboursementsModule,
    DocumentsModule,
    AlertesModule,
    TableauDeBordModule,
    IndicesIrlModule,
    BailDocumentDocxModule,
    EtatsDesLieuxModule,
    EtatDesLieuxDocumentDocxModule
  ]
})
export class AppModule {}
