import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class BootstrapDto {
  @IsString() @MaxLength(150) nombre_completo: string;
  @IsString()
  @MaxLength(30)
  @Matches(/^[A-Za-z0-9 .-]+$/)
  cedula_identidad: string;
  @IsString() @MaxLength(80) usuario: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
}
