import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdatePlaylistDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'nombre no puede estar vacío' })
  @MaxLength(150)
  nombre?: string;
  @IsOptional() @IsString() @MaxLength(1000) descripcion?: string;
}
