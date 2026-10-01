import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Category update request contract (Req 8.5).
 *
 * Only the `name` is mutable. Like {@link CreateCategoryDto}, the DTO enforces
 * a non-empty string within a generous bound and the service applies the
 * authoritative trim + 1-100 length + case-insensitive uniqueness rules
 * (excluding the category itself). `name` is required on update because it is
 * the only editable field (Req 8.5).
 */
export class UpdateCategoryDto {
  @ApiProperty({
    description:
      'New category name. Trimmed, then must be 1-100 characters and unique ' +
      '(case-insensitive) among your other categories.',
    example: 'Household',
    maxLength: 100,
  })
  @IsNotEmpty({ message: 'name is required' })
  @IsString({ message: 'name must be a string' })
  @MaxLength(500, { message: 'name must be at most 100 characters' })
  name!: string;
}
