import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Fields required to persist a new user (never includes plaintext). */
export interface CreateUserInput {
  /** Email preserving the user's original casing. */
  email: string;
  /** Normalized (lowercased/trimmed) email for case-insensitive uniqueness (Req 1.2). */
  emailCi: string;
  /** Salted argon2id hash of the password — never the plaintext (Req 1.5). */
  passwordHash: string;
}

/**
 * Thin repository over `PrismaService` for user persistence (Req 1).
 *
 * Keeps Prisma access encapsulated (design §Layer responsibilities). The
 * service intentionally exposes only the operations Auth needs and never
 * returns/derives plaintext credentials.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Looks up a user by the normalized (case-insensitive) email. Used to enforce
   * unique registration (Req 1.2) and to resolve the login principal (Req 2).
   */
  findByEmailCi(emailCi: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { emailCi } });
  }

  /** Loads a user by primary key (used to resolve the token principal). */
  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** Persists a new user record. Stores only the salted hash (Req 1.5). */
  create(input: CreateUserInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: input.email,
        emailCi: input.emailCi,
        passwordHash: input.passwordHash,
      },
    });
  }
}
