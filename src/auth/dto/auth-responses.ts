import { ApiProperty } from '@nestjs/swagger';

/**
 * OpenAPI response schemas for the auth endpoints (Req 18.1, 18.2).
 *
 * These classes exist ONLY to document the response contract in Swagger; they
 * mirror the shapes returned by `AuthService` (`PublicUser`, `IssuedToken`).
 * They deliberately never include `passwordHash` or any secret material.
 */

/** The created/authenticated user representation — never includes the hash. */
export class UserResponse {
  @ApiProperty({
    description: 'Unique user identifier (UUID).',
    format: 'uuid',
    example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  })
  id!: string;

  @ApiProperty({
    description: "The user's email address (original casing preserved).",
    format: 'email',
    example: 'ada@example.com',
  })
  email!: string;

  @ApiProperty({
    description: 'When the account was created (ISO 8601).',
    format: 'date-time',
    example: '2024-01-15T09:24:00.000Z',
  })
  createdAt!: Date;
}

/** The token payload returned on successful login. */
export class LoginResponse {
  @ApiProperty({
    description: 'Signed JWT Authentication_Token presented as a Bearer token.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken!: string;

  @ApiProperty({
    description: 'The token scheme; always "Bearer".',
    example: 'Bearer',
    enum: ['Bearer'],
  })
  tokenType!: 'Bearer';

  @ApiProperty({
    description: 'Token lifetime in seconds (3600s / 1 hour).',
    example: 3600,
  })
  expiresIn!: number;
}

/** A single failing-field entry inside a validation error response. */
export class ValidationErrorDetail {
  @ApiProperty({
    description: 'The field that failed validation.',
    example: 'email',
  })
  field!: string;

  @ApiProperty({
    description: 'Why the field failed.',
    example: 'email must be a valid email address',
  })
  reason!: string;
}

/** Metadata block echoed on every response (Req 14.6). */
export class ResponseMeta {
  @ApiProperty({
    description:
      'The request correlation id (echoed from the client or generated); ' +
      'null when none is present.',
    nullable: true,
    example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  })
  correlationId!: string | null;
}

/** The `error` block inside the consistent error envelope (Req 13.1). */
export class ErrorBody {
  @ApiProperty({
    description: 'Machine-readable error code.',
    example: 'VALIDATION_ERROR',
    enum: [
      'VALIDATION_ERROR',
      'AUTH_REQUIRED',
      'AUTH_FAILED',
      'ACCOUNT_LOCKED',
      'CONFLICT',
      'NOT_FOUND',
      'INTERNAL_ERROR',
    ],
  })
  code!: string;

  @ApiProperty({
    description: 'Human-readable message (<= 500 characters).',
    example: 'Validation failed',
  })
  message!: string;

  @ApiProperty({
    description:
      'Per-field validation failures (present for VALIDATION_ERROR).',
    type: [ValidationErrorDetail],
    required: false,
  })
  details?: ValidationErrorDetail[];
}

/**
 * The consistent error envelope (design §API Design / §Error Handling, Req 13.1)
 * returned by EVERY endpoint on failure — the exact shape produced by
 * `AllExceptionsFilter`.
 *
 * Documented here so each endpoint can reference at least one failure
 * representation (Req 18.2). The `success` flag is the explicit success/failure
 * indicator (always `false` here) required by Req 18.2.
 */
export class ErrorResponse {
  @ApiProperty({
    description:
      'Success/failure indicator (Req 18.2); always false on an error response.',
    example: false,
    enum: [false],
  })
  success!: false;

  @ApiProperty({
    description: 'The error detail block.',
    type: ErrorBody,
  })
  error!: ErrorBody;

  @ApiProperty({
    description: 'Response metadata (correlation id).',
    type: ResponseMeta,
  })
  meta!: ResponseMeta;
}
