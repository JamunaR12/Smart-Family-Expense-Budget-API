import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { AuthService, PublicUser } from './auth.service';
import { IssuedToken } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ErrorResponse,
  LoginResponse,
  UserResponse,
} from './dto/auth-responses';

/**
 * Authentication HTTP boundary (Req 1, 2).
 *
 * Served under the global `/api/v1` surface (prefix + URI versioning) as
 * `/api/v1/auth/*`. Both endpoints are `@Public()` so the global
 * `JwtAuthGuard` does not require a token to reach them (Req 3.4). Business
 * logic lives in `AuthService`; the controller only binds and delegates.
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Registers a new account (Req 1). Returns the created user (never the hash). */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new user account',
    description:
      'Creates a User account after validating the email (RFC 5322, 3-254 ' +
      'chars) and password policy (8-128 chars with upper/lower/digit/special). ' +
      'Emails are unique case-insensitively. Only a salted hash is stored — ' +
      'never the plaintext password.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Account created. Returns the created user (never the hash).',
    type: UserResponse,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'VALIDATION_ERROR — the email or password failed validation; the ' +
      'response identifies each failing field.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'CONFLICT — an account with this email (case-insensitive) already exists.',
    type: ErrorResponse,
  })
  register(@Body() dto: RegisterDto): Promise<PublicUser> {
    return this.authService.register(dto);
  }

  /** Authenticates and issues a 3600s JWT (Req 2). */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in and obtain an Authentication_Token',
    description:
      'Verifies credentials and issues a signed JWT valid for 3600 seconds. ' +
      'A wrong email and a wrong password return the SAME generic error so the ' +
      'failing field is not disclosed. After 5 consecutive failures within a ' +
      '15-minute window the account is locked for 900 seconds.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Authenticated. Returns a Bearer token and its lifetime.',
    type: LoginResponse,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'VALIDATION_ERROR — a required credential (email or password) is ' +
      'missing or empty.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description:
      'AUTH_FAILED — invalid email or password (non-disclosing); or ' +
      'ACCOUNT_LOCKED — the account is temporarily locked after too many ' +
      'failed attempts.',
    type: ErrorResponse,
  })
  login(@Body() dto: LoginDto): Promise<IssuedToken> {
    return this.authService.login(dto);
  }
}
