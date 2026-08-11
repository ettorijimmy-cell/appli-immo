import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CreateRemboursementDto } from "./dto/create-remboursement.dto";
import { RemboursementsService } from "./remboursements.service";

@Controller("remboursements")
export class RemboursementsController {
  constructor(private readonly remboursementsService: RemboursementsService) {}

  @Post()
  create(@Body() dto: CreateRemboursementDto) {
    return this.remboursementsService.create(dto);
  }

  @Get()
  findAll(@Query("bailId") bailId?: string) {
    return this.remboursementsService.findAll(bailId);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.remboursementsService.archive(id);
  }
}
