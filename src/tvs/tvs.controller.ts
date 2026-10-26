import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { TvsService } from './tvs.service.js';
import { CreateTvDto } from './dto/create-tv.dto.js';
import { UpdateTvDto } from './dto/update-tv.dto.js';
import { ConnectTvDto } from './dto/connect-tv.dto.js';
import { TvsGateway } from './tvs.gateway.js';
import { RegisterTvDto } from './dto/register-tv.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { TvPaginationQueryDto } from './dto/tv-pagination-query.dto.js';
@Controller('tvs')
export class TvsController {
  constructor(
    private readonly service: TvsService,
    private readonly gateway: TvsGateway,
  ) {}
  @Post() @RequirePermissions('tvs.register') async create(
    @Body() dto: CreateTvDto,
  ) {
    const tv = await this.service.create(dto);
    await this.gateway.confirmRegistration(dto.tv_id);
    return tv;
  }
  @Public()
  @Post('/connect')
  async connect(@Body() dto: ConnectTvDto) {
    const result = await this.service.connect(dto);
    console.log('connect', dto, result);
    try {
      await this.gateway.registerDevice(dto, result.tvId);
    } catch (error) {
      this.service.releaseTemporaryTvId(result.tvId);
      throw error;
    }
    return result;
  }
  @Post('/register')
  @RequirePermissions('tvs.register')
  async register(@Body() dto: RegisterTvDto) {
    const tv = await this.service.register(dto);
    await this.gateway.confirmRegistration(dto.tv_id);
    return tv;
  }
  @Get() @RequirePermissions('tvs.view') findAll(
    @Query() query: TvPaginationQueryDto,
  ) {
    return this.service.findAll(query);
  }
  @Get(':id') @RequirePermissions('tvs.view') findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
  @Put(':id') @RequirePermissions('tvs.edit') update(
    @Param('id') id: string,
    @Body() dto: UpdateTvDto,
  ) {
    return this.service.update(id, dto);
  }
  @Delete(':id') @RequirePermissions('tvs.delete') remove(
    @Param('id') id: string,
  ) {
    return this.service.remove(id);
  }
}
