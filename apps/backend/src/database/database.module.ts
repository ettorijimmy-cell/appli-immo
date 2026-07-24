import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { createDbClient, DEFAULT_DEV_DATABASE_URL } from "db";

export const DATABASE_CONNECTION = Symbol("DATABASE_CONNECTION");

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DATABASE_CONNECTION,
      inject: [ConfigService],
      // postgres.js se connecte paresseusement : la valeur par défaut pointe
      // vers le Postgres de dev local (docker-compose.yml). Une vraie
      // requête échouera tant que ce conteneur ne tourne pas — ou qu'un
      // DATABASE_URL de production (Scaleway) n'est pas fourni.
      useFactory: (config: ConfigService) =>
        createDbClient(config.get<string>("DATABASE_URL", DEFAULT_DEV_DATABASE_URL))
    }
  ],
  exports: [DATABASE_CONNECTION]
})
export class DatabaseModule {}
