import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppartementsModule } from "./appartements/appartements.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { ComptesBancairesSciModule } from "./comptes-bancaires-sci/comptes-bancaires-sci.module";
import { EncryptionModule } from "./crypto/encryption.module";
import { DatabaseModule } from "./database/database.module";
import { EquipementsModule } from "./equipements/equipements.module";
import { ImmeublesModule } from "./immeubles/immeubles.module";
import { ScisModule } from "./scis/scis.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    EncryptionModule,
    AuditModule,
    AuthModule,
    ScisModule,
    ComptesBancairesSciModule,
    ImmeublesModule,
    AppartementsModule,
    EquipementsModule
  ]
})
export class AppModule {}
