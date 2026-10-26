import {
  BadRequestException,
  Next,
  NotFoundException,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { NextFunction, Response } from 'express';
import type { MediaFile } from '../tvs/transfers.service.js';
import { ContenidoPaginationQueryDto } from './dto/contenido-pagination-query.dto.js';
import { CONTENT_STAGING_DIR } from './media-storage.js';
import { ContenidosService } from './contenidos.service.js';
import { CreateContenidoDto } from './dto/create-contenido.dto.js';
import { UpdateContenidoDto } from './dto/update-contenido.dto.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
@Controller('contenidos')
export class ContenidosController {
  constructor(private readonly service: ContenidosService) {}
  @Post() @RequirePermissions('content.upload') create(
    @Body() dto: CreateContenidoDto,
  ) {
    return this.service.create(dto);
  }
  @Post('archivos')
  @RequirePermissions('content.upload')
  @UseInterceptors(
    FilesInterceptor('files', 6, {
      dest: CONTENT_STAGING_DIR,
      limits: { files: 6, fileSize: 100 * 1024 * 1024, fields: 0 },
      fileFilter: (_req, file, cb) => {
        const accepted = /^(image|video)\/[a-z0-9.+-]+$/i.test(file.mimetype);
        cb(
          accepted
            ? null
            : new BadRequestException('Solo se permiten im�genes o videos'),
          accepted,
        );
      },
    }),
  )
  upload(@UploadedFiles() files: (MediaFile & { filename: string })[]) {
    return this.service.upload(files);
  }
  @Get(':id/archivo')
  @RequirePermissions('content.view')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    const file = await this.service.getFile(id);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(file.nombre);
    return res.download(file.path, file.nombre, (error) => {
      if (!error) return;
      if (['ECONNABORTED', 'ECONNRESET'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      // La limpieza puede borrar el archivo entre la comprobación y el envío.
      if (
        !res.headersSent &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        next(
          new NotFoundException(
            'El archivo ya no está disponible. Vuelve a subirlo en Contenido.',
          ),
        );
        return;
      }
      next(error);
    });
  }
  @Get() @RequirePermissions('content.view') findAll(
    @Query() query: ContenidoPaginationQueryDto,
  ) {
    return this.service.findAll(query);
  }
  @Get(':id') @RequirePermissions('content.view') findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(id);
  }
  @Patch(':id') @RequirePermissions('content.upload') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContenidoDto,
  ) {
    return this.service.update(id, dto);
  }
  @Delete(':id') @RequirePermissions('content.delete') remove(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(id);
  }
}
