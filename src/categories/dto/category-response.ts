import { ApiProperty } from '@nestjs/swagger';
import type { Category } from '@prisma/client';

/**
 * API representation of a Category (Req 8.1, 8.4).
 *
 * Built via {@link toCategoryResponse} from a Prisma `Category` row that has
 * ALREADY been owner-scoped, so no field ever carries another user's data.
 * The internal isolation key `userId` and the normalized `nameCi` are
 * deliberately NOT surfaced (Req 3.3) — only the display `name` is returned.
 */
export class CategoryResponse {
  @ApiProperty({
    description: 'Unique category identifier (UUID).',
    format: 'uuid',
    example: '7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c',
  })
  id!: string;

  @ApiProperty({
    description: 'Category display name (trimmed).',
    example: 'Groceries',
  })
  name!: string;

  @ApiProperty({
    description: 'When the category was created (ISO 8601).',
    format: 'date-time',
    example: '2024-01-15T09:24:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'When the category was last updated (ISO 8601).',
    format: 'date-time',
    example: '2024-01-15T09:24:00.000Z',
  })
  updatedAt!: Date;
}

/** A list of categories (Req 8.4). */
export class CategoryListResponse {
  @ApiProperty({ type: [CategoryResponse] })
  data!: CategoryResponse[];
}

/** Confirmation returned on successful deletion (Req 8.8). */
export class DeleteCategoryResponse {
  @ApiProperty({
    description: 'Always true on a successful delete.',
    example: true,
  })
  deleted!: boolean;

  @ApiProperty({
    description: 'Identifier of the deleted category.',
    format: 'uuid',
    example: '7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c',
  })
  id!: string;
}

/**
 * Maps a Prisma `Category` row to the public {@link CategoryResponse}.
 *
 * The caller MUST pass a row already restricted to the authenticated owner
 * (owner-scoped query). `userId` and `nameCi` are deliberately dropped.
 */
export function toCategoryResponse(category: Category): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}
