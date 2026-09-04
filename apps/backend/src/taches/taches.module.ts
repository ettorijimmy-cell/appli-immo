import { Module } from "@nestjs/common";
import { GoogleOAuthModule } from "../google-oauth/google-oauth.module";
import { IndicesIrlModule } from "../indices-irl/indices-irl.module";
import { ModelesCourrierModule } from "../modeles-courrier/modeles-courrier.module";
import { QuittanceDocumentDocxModule } from "../quittance-document-docx/quittance-document-docx.module";
import { UsersModule } from "../users/users.module";
import { TachesController } from "./taches.controller";
import { TachesJobService } from "./taches-job.service";
import { TachesService } from "./taches.service";

@Module({
  imports: [IndicesIrlModule, ModelesCourrierModule, UsersModule, GoogleOAuthModule, QuittanceDocumentDocxModule],
  controllers: [TachesController],
  providers: [TachesJobService, TachesService],
  exports: [TachesJobService, TachesService]
})
export class TachesModule {}
