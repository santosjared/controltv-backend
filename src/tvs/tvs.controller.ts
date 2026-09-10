import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { TvsService } from './tvs.service.js';
import { CreateTvDto } from './dto/create-tv.dto.js';
import { UpdateTvDto } from './dto/update-tv.dto.js';
import { ConnectTvDto } from './dto/connect-tv.dto.js';
import { TvsGateway } from './tvs.gateway.js';
import { RegisterTvDto } from './dto/register-tv.dto.js';
@Controller('tvs')
export class TvsController {
  constructor(
    private readonly service: TvsService,
    private readonly gateway: TvsGateway,
  ) {}
  @Post() create(@Body() dto: CreateTvDto) {
    return this.service.create(dto);
  }
  @Post('/connect') async connect(@Body() dto: ConnectTvDto) {
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
  @Post('/register') async register(@Body() dto: RegisterTvDto) {
    const tv = await this.service.register(dto);
    await this.gateway.confirmRegistration(dto.tv_id);
    return tv;
  }
  @Get() findAll() {
    return this.service.findAll();
  }
  @Get(':id') findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateTvDto) {
    return this.service.update(id, dto);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
