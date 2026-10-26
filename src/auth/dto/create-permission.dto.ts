import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreatePermissionDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9_.-]*$|^\*$/)
  clave: string;

  @IsString() @MaxLength(150) nombre: string;

  @IsString() @MaxLength(80) modulo: string;

  @IsOptional() @IsString() @MaxLength(200) descripcion?: string;
}
