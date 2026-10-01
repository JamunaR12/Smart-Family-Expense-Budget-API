import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Login request contract (Req 2.3).
 *
 * Both fields must be present and non-empty; a missing/empty email or password
 * is rejected as a validation error by the global `ValidationPipe` BEFORE any
 * credential verification (Req 2.3). The email is intentionally NOT restricted
 * with `@IsEmail` here — login only needs a non-empty value to look up the
 * account; over-restricting would change the error surface for existing users.
 */
export class LoginDto {
  @ApiProperty({
    description: 'The account email address.',
    format: 'email',
    example: 'ada@example.com',
  })
  @IsString({ message: 'email must be a string' })
  @IsNotEmpty({ message: 'email is required' })
  email!: string;

  @ApiProperty({
    description: 'The account password.',
    format: 'password',
    example: 'Str0ng!Pass',
  })
  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password is required' })
  password!: string;
}
