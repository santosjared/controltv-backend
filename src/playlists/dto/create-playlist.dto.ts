import {
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PlaylistItemDto } from './playlist-item.dto.js';

export class CreatePlaylistDto {
  @IsString()
  @Matches(/\S/, { message: 'nombre no puede estar vacío' })
  @MaxLength(150)
  nombre: string;
  @IsOptional() @IsString() @MaxLength(1000) descripcion?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlaylistItemDto)
  imagenes?: PlaylistItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlaylistItemDto)
  items?: PlaylistItemDto[];
}
