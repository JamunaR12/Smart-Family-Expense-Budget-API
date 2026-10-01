import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Password hashing service (Req 1.5, Validates Property 13).
 *
 * Uses argon2id — a memory-hard KDF resistant to GPU/side-channel attacks.
 * argon2 generates a UNIQUE random salt for every hash and embeds it (together
 * with the algorithm parameters) inside the returned encoded string. That
 * means:
 * - two users who choose the same password get DIFFERENT stored hashes
 *   (unique per-user salt, Req 1.5 / Property 13); and
 * - verification needs only the stored hash and the candidate plaintext — no
 *   separate salt column is required.
 *
 * The plaintext password is never stored, returned, or logged.
 */
@Injectable()
export class PasswordHasher {
  /**
   * Hashes a plaintext password with argon2id. The returned string embeds the
   * algorithm, parameters, and a freshly generated per-user salt (Req 1.5).
   */
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  /**
   * Verifies a candidate plaintext against a stored argon2 hash. Returns `false`
   * (rather than throwing) on any malformed hash so callers surface a single
   * generic authentication failure (Req 2.2).
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
