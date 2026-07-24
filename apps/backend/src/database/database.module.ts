import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { createDbClient } from "db";

export const DATABASE_CONNECTION = Symbol("DATABASE_CONNECTION");

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DATABASE_CONNECTION,
      inject: [ConfigService],
      // postgres.js se connecte paresseusement : la valeur par défaut permet
      // au squelette de démarrer avant le provisionnement Scaleway (voir
      // docs/backlog.md, Module 0). Une vraie requête échouera tant que
      // DATABASE_URL ne pointe pas vers une instance réelle.
      useFactory: (config: ConfigService) =>
        createDbClient(config.get<string>("DATABASE_URL", "postgres://localhost:5432/appli_immo_dev"))
    }
  ],
  exports: [DATABASE_CONNECTION]
})
export class DatabaseModule {}
