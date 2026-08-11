import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CreateGarantDto } from "./dto/create-garant.dto";
import { UpdateGarantDto } from "./dto/update-garant.dto";
import { GarantsService } from "./garants.service";

@Controller("garants")
export class GarantsController {
  constructor(private readonly garantsService: GarantsService) {}

  @Post()
  create(@Body() dto: CreateGarantDto) {
    return this.garantsService.create(dto);
  }

  @Get()
  findAll(@Query("bailId") bailId?: string) {
    return this.garantsService.findAll(bailId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.garantsService.findById(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateGarantDto) {
    return this.garantsService.update(id, dto);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.garantsService.archive(id);
  }
}
