import { Controller, Get, Param, Query } from "@nestjs/common";
import { ImmeublesService } from "./immeubles.service";

// Lecture seule (voir ImmeublesService) : pas d'endpoints POST/PATCH.
@Controller("immeubles")
export class ImmeublesController {
  constructor(private readonly immeublesService: ImmeublesService) {}

  @Get()
  findAll(@Query("sciId") sciId?: string) {
    return this.immeublesService.findAll(sciId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.immeublesService.findById(id);
  }
}
