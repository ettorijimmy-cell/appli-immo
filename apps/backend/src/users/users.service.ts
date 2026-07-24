import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { utilisateurs, type Database } from "db";
import { DATABASE_CONNECTION } from "../database/database.module";

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async findByEmail(email: string) {
    const [user] = await this.db
      .select()
      .from(utilisateurs)
      .where(eq(utilisateurs.email, email))
      .limit(1);
    return user ?? null;
  }

  async findById(id: string) {
    const [user] = await this.db.select().from(utilisateurs).where(eq(utilisateurs.id, id)).limit(1);
    return user ?? null;
  }
}
