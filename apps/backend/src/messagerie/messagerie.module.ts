import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { StorageModule } from "../storage/storage.module";
import { UsersModule } from "../users/users.module";
import { BoiteMailDedieeService } from "./boite-mail-dediee.service";
import { ClassificationMessageService } from "./classification-message.service";
import { ImapSyncJobService } from "./imap-sync-job.service";
import { MessagerieController } from "./messagerie.controller";
import { MessagesCommunicationService } from "./messages-communication.service";
import { SmtpEnvoiService } from "./smtp-envoi.service";

@Module({
  imports: [UsersModule, StorageModule, DocumentsModule],
  controllers: [MessagerieController],
  providers: [
    BoiteMailDedieeService,
    ClassificationMessageService,
    SmtpEnvoiService,
    ImapSyncJobService,
    MessagesCommunicationService
  ],
  exports: [BoiteMailDedieeService, SmtpEnvoiService]
})
export class MessagerieModule {}
