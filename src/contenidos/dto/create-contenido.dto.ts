import {
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { TipoContenido } from '../entities/contenido.entity.js';
export class CreateContenidoDto {
  @IsString() @MaxLength(150) nombre: string;
  @IsEnum(TipoContenido) tipo: TipoContenido;
  @IsUrl({ require_tld: false }) url: string;
  @IsOptional() @IsNumberString() tamano_bytes?: string;
}
