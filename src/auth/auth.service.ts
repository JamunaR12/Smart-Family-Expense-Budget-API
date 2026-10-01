import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { PasswordHasher } from './password-hasher';
import { TokenService, IssuedToken } from './token.service';
import { LockoutService } from './lockout.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/** Machine-readable code for a duplicate registration (Req 1.2). */
export const CONFLICT_CODE = 'CONFLICT';

/**
 * Machine-readable code for a failed login. Deliberately identical for
 * wrong-email and wrong-password so the response never discloses which field
 * was incorrect (Req 2.2, Validates Property 11).
 */
export const AUTH_FAILED_CODE = 'AUTH_FAILED';

/** Public representation of a created/authenticated user (never the hash). */
export interface PublicUser {
  id: string;
  email: string;
  createdAt: Date;
}

/**
 * Authentication business logic (Req 1, 2).
 *
 * Orchestrates registration (hash + case-insensitive uniqueness) and login
 * (lockout check -> credential verification -> token issuance). Never returns
 * or logs the password hash or plaintext.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly lockout: LockoutService,
  ) {}

  /** Normalizes an email to its case-insensitive form for lookups/uniqueness. */
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Registers a new user (Req 1.1, 1.2, 1.5; Validates Property 14, 15).
   *
   * Rejects a case-insensitive duplicate with a conflict, leaving the existing
   * user unchanged (Req 1.2). Also maps the DB unique-constraint violation
   * (P2002) to a conflict so concurrent duplicate registration is safe.
   */
  async register(dto: RegisterDto): Promise<PublicUser> {
    const emailCi = this.normalizeEmail(dto.email);

    const existing = await this.users.findByEmailCi(emailCi);
    if (existing) {
      throw new ConflictException({
        code: CONFLICT_CODE,
        message: 'An account with this email already exists',
      });
    }

    const passwordHash = await this.hasher.hash(dto.password);

    try {
      const user = await this.users.create({
        email: dto.email.trim(),
        emailCi,
        passwordHash,
      });
      return { id: user.id, email: user.email, createdAt: user.createdAt };
    } catch (error) {
      // Handle the race where two concurrent requests pass the pre-check: the
      // unique index on emailCi rejects the second insert (Req 1.2).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: CONFLICT_CODE,
          message: 'An account with this email already exists',
        });
      }
      throw error;
    }
  }

  /**
   * Authenticates a user and issues a token (Req 2.1-2.4, 2.7; Validates
   * Property 10, 11, 12).
   *
   * Ordering: DTO validation (global pipe) -> lockout check -> credential
   * verification -> on failure record the attempt (maybe lock) -> on success
   * reset the counter and issue the token. A wrong email and a wrong password
   * produce the SAME generic error (Req 2.2).
   */
  async login(dto: LoginDto): Promise<IssuedToken> {
    const emailCi = this.normalizeEmail(dto.email);

    // Reject up front if the account is currently locked (Req 2.7). Applies
    // even when the supplied credentials are correct.
    await this.lockout.assertNotLocked(emailCi);

    const user = await this.users.findByEmailCi(emailCi);
    const passwordValid = user
      ? await this.hasher.verify(user.passwordHash, dto.password)
      : false;

    if (!user || !passwordValid) {
      // Record the failure (which may trip the lock) then reject generically.
      await this.lockout.recordFailure(emailCi);
      throw new UnauthorizedException({
        code: AUTH_FAILED_CODE,
        message: 'Invalid email or password',
      });
    }

    // Successful auth resets consecutive-failure state (Req 2.7).
    await this.lockout.recordSuccess(emailCi);
    return this.tokens.issueToken(user);
  }
}
