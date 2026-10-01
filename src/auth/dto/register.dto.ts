import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches } from 'class-validator';

/**
 * Password complexity rule (Req 1.1, 1.4): at least one lowercase letter, one
 * uppercase letter, one digit, and one special (non-alphanumeric) character.
 * Length (8-128) is enforced separately by `@Length` so the two failures are
 * reported independently.
 */
const PASSWORD_COMPLEXITY =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

/**
 * Registration request contract (Req 1.1, 1.3, 1.4).
 *
 * class-validator enforces every field before the request reaches business
 * logic (the global `ValidationPipe`, wired now in `configureApp()` and
 * finalized by task 7.1). Per-field messages let the error envelope identify
 * exactly which field failed (Req 1.3, 1.4, 13.4).
 */
export class RegisterDto {
  /**
   * RFC 5322 email address, 3-254 characters inclusive (Req 1.1, 1.3).
   */
  @ApiProperty({
    description:
      'RFC 5322 email address, 3-254 characters. Case-insensitively unique.',
    format: 'email',
    minLength: 3,
    maxLength: 254,
    example: 'ada@example.com',
  })
  @IsString({ message: 'email must be a string' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @Length(3, 254, {
    message: 'email must be between 3 and 254 characters',
  })
  email!: string;

  /**
   * Password, 8-128 chars with upper/lower/digit/special (Req 1.1, 1.4).
   */
  @ApiProperty({
    description:
      'Password, 8-128 characters, containing at least one uppercase letter, ' +
      'one lowercase letter, one digit, and one special character.',
    minLength: 8,
    maxLength: 128,
    format: 'password',
    example: 'Str0ng!Pass',
  })
  @IsString({ message: 'password must be a string' })
  @Length(8, 128, {
    message: 'password must be between 8 and 128 characters',
  })
  @Matches(PASSWORD_COMPLEXITY, {
    message:
      'password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character',
  })
  password!: string;
}
