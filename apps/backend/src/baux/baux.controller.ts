import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { BauxService } from "./baux.service";
import { CreateBailDto } from "./dto/create-bail.dto";
import { ResilierBailDto } from "./dto/resilier-bail.dto";
import { UpdateBailDto } from "./dto/update-bail.dto";

@UseGuards(JwtAuthGuard)
@Controller("baux")
export class BauxController {
  constructor(private readonly bauxService: BauxService) {}

  @Post()
  create(@Body() dto: CreateBailDto) {
    return this.bauxService.create(dto);
  }

  @Get()
  findAll(@Query("appartementId") appartementId?: string) {
    return this.bauxService.findAll(appartementId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.bauxService.findById(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateBailDto) {
    return this.bauxService.update(id, dto);
  }

  @Patch(":id/activer")
  activer(@Param("id") id: string) {
    return this.bauxService.activer(id);
  }

  @Patch(":id/resilier")
  resilier(@Param("id") id: string, @Body() dto: ResilierBailDto) {
    return this.bauxService.resilier(id, dto);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.bauxService.archive(id);
  }
}
