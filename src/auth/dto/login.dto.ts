import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @MaxLength(80) usuario: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
}
