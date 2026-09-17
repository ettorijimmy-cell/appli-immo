import { Module } from "@nestjs/common";
import { IndicesIrlModule } from "../indices-irl/indices-irl.module";
import { MessagerieModule } from "../messagerie/messagerie.module";
import { ModelesCourrierModule } from "../modeles-courrier/modeles-courrier.module";
import { QuittanceDocumentDocxModule } from "../quittance-document-docx/quittance-document-docx.module";
import { UsersModule } from "../users/users.module";
import { TachesController } from "./taches.controller";
import { TachesJobService } from "./taches-job.service";
import { TachesService } from "./taches.service";

// GoogleOAuthModule retiré (Module Messagerie, unification 2026-09-16,
// décision actée avec Jimmy) : les envois automatiques passent désormais
// par la boîte mail dédiée (SmtpEnvoiService), plus par le compte Gmail
// OAuth personnel. GoogleOAuthModule/connexion_gmail restent dormants
// (routes et écran Paramètres inchangés) — retirés explicitement dans un
// commit séparé une fois l'unification éprouvée en usage réel, pas ici.
@Module({
  imports: [IndicesIrlModule, ModelesCourrierModule, UsersModule, MessagerieModule, QuittanceDocumentDocxModule],
  controllers: [TachesController],
  providers: [TachesJobService, TachesService],
  exports: [TachesJobService, TachesService]
})
export class TachesModule {}
