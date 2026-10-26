import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class PlaylistItemDto {
  @IsUUID() contenido_id: string;
  @IsOptional() @IsInt() @Min(0) orden?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3600) duracion_segundos?: number;
}
