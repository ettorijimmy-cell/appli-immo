import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { UsersModule } from "../users/users.module";
import { GoogleOAuthController } from "./google-oauth.controller";
import { GoogleOAuthService } from "./google-oauth.service";

@Module({
  imports: [DatabaseModule, UsersModule],
  controllers: [GoogleOAuthController],
  providers: [GoogleOAuthService],
  exports: [GoogleOAuthService]
})
export class GoogleOAuthModule {}
