import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { EstadoReproduccion } from '../entities/estado-tv.entity.js';
export class CreateEstadoTvDto {
  @IsUUID() tv_id: string;
  @IsOptional() @IsUUID() contenido_id?: string;
  @IsOptional()
  @IsEnum(EstadoReproduccion)
  estado_reproduccion?: EstadoReproduccion;
  @IsOptional() @IsInt() @Min(0) posicion_segundos?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) volumen?: number;
  @IsOptional() @IsBoolean() repetir?: boolean;
}
