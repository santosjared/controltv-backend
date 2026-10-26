import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../auth/dto/pagination-query.dto.js';
import { TipoContenido } from '../entities/contenido.entity.js';

export class ContenidoPaginationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TipoContenido)
  type?: TipoContenido;
}
