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
import { BienModule } from "./bien/bien.module";
import { CalendrierAbonnementModule } from "./calendrier-abonnement/calendrier-abonnement.module";
import { CandidatsModule } from "./candidats/candidats.module";
import { CommonModule } from "./common/common.module";
import { ComptesBancairesSciModule } from "./comptes-bancaires-sci/comptes-bancaires-sci.module";
import { ContactsModule } from "./contacts/contacts.module";
import { EncryptionModule } from "./crypto/encryption.module";
import { DatabaseModule } from "./database/database.module";
import { DepensesModule } from "./depenses/depenses.module";
import { DocumentsModule } from "./documents/documents.module";
import { EquipementsModule } from "./equipements/equipements.module";
import { EtatDesLieuxDocumentDocxModule } from "./etat-des-lieux-document-docx/etat-des-lieux-document-docx.module";
import { EtatsDesLieuxModule } from "./etats-des-lieux/etats-des-lieux.module";
import { EvenementsCalendrierModule } from "./evenements-calendrier/evenements-calendrier.module";
import { FiscaliteModule } from "./fiscalite/fiscalite.module";
import { GarantsModule } from "./garants/garants.module";
import { GoogleOAuthModule } from "./google-oauth/google-oauth.module";
import { ImmeublesModule } from "./immeubles/immeubles.module";
import { IndicesIrlModule } from "./indices-irl/indices-irl.module";
import { LocatairesModule } from "./locataires/locataires.module";
import { ModelesCourrierModule } from "./modeles-courrier/modeles-courrier.module";
import { PaiementsModule } from "./paiements/paiements.module";
import { PowerSyncModule } from "./powersync/powersync.module";
import { QuittanceDocumentDocxModule } from "./quittance-document-docx/quittance-document-docx.module";
import { ReferencesModule } from "./references/references.module";
import { ReglesCategorisationModule } from "./regles-categorisation/regles-categorisation.module";
import { RemboursementsModule } from "./remboursements/remboursements.module";
import { ScisModule } from "./scis/scis.module";
import { SinistresModule } from "./sinistres/sinistres.module";
import { TableauDeBordModule } from "./tableau-de-bord/tableau-de-bord.module";
import { TachesModule } from "./taches/taches.module";
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
    BienModule,
    AppartementsModule,
    EquipementsModule,
    LocatairesModule,
    BauxModule,
    GarantsModule,
    BailLocatairesModule,
    ContactsModule,
    CandidatsModule,
    EvenementsCalendrierModule,
    CalendrierAbonnementModule,
    SinistresModule,
    PaiementsModule,
    VersementsModule,
    RemboursementsModule,
    ReglesCategorisationModule,
    DepensesModule,
    DocumentsModule,
    ReferencesModule,
    AlertesModule,
    TachesModule,
    ModelesCourrierModule,
    TableauDeBordModule,
    FiscaliteModule,
    IndicesIrlModule,
    BailDocumentDocxModule,
    EtatsDesLieuxModule,
    EtatDesLieuxDocumentDocxModule,
    QuittanceDocumentDocxModule,
    GoogleOAuthModule,
    PowerSyncModule
  ]
})
export class AppModule {}
