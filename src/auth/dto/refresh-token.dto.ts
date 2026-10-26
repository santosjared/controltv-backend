import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString() @MinLength(40) @MaxLength(500) refresh_token: string;
}
