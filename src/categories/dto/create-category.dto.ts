import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Category creation request contract (Req 8.1-8.3).
 *
 * The DTO only guarantees `name` is a non-empty string within a generous
 * upper bound; the authoritative normalization (trim) and the 1-100 char
 * length rule evaluated AFTER trimming are applied in the service so there is
 * a SINGLE source of truth for the constraint (Req 8.1, 8.2). This lets
 * " Food " and "food" collide and lets an all-whitespace name be rejected as a
 * field-level VALIDATION_ERROR naming `name`.
 *
 * The DTO bound (500) is intentionally larger than the trimmed limit (100) so
 * a value like "  <95 chars>  " that trims to <=100 is not rejected by the
 * pipe before the service can normalize it.
 */
export class CreateCategoryDto {
  @ApiProperty({
    description:
      'Category name. Trimmed of leading/trailing whitespace, then must be ' +
      '1-100 characters and unique (case-insensitive) among your categories.',
    example: 'Groceries',
    maxLength: 100,
  })
  @IsNotEmpty({ message: 'name is required' })
  @IsString({ message: 'name must be a string' })
  @MaxLength(500, { message: 'name must be at most 100 characters' })
  name!: string;
}
