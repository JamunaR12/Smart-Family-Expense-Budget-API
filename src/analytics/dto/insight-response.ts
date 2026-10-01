import { ApiProperty } from '@nestjs/swagger';

/**
 * Monthly spending insight (Req 11.1, 11.4, 11.5).
 *
 * `total` is the arithmetic sum of the amounts of the user's expenses dated
 * within `month`, serialized as a two-decimal STRING (design ADR-5). When the
 * user has no matching expenses the total is `"0.00"` and no error is returned
 * (Req 11.4, Property 4).
 *
 * MIXED CURRENCY (A2): amounts are summed NUMERICALLY regardless of their per-
 * expense currency; no currency conversion is performed. The total is therefore
 * a plain numeric sum of amounts (Req 11.5). Cross-currency semantics are out
 * of scope (A2, design §Ambiguities item 3).
 */
export class MonthlyInsightResponse {
  @ApiProperty({
    description: 'The month the insight was computed for (YYYY-MM).',
    example: '2024-01',
  })
  month!: string;

  @ApiProperty({
    description:
      'Arithmetic sum of in-month expense amounts as a two-decimal string ' +
      '(numeric sum across currencies; no conversion, A2).',
    example: '1234.56',
  })
  total!: string;
}

/** A single category's total within the requested range (Req 11.2). */
export class CategoryTotal {
  @ApiProperty({
    description: 'Identifier of the category.',
    format: 'uuid',
    example: '7c3e0b1a-9d5f-4c2e-8a6b-1f2d3e4a5b6c',
  })
  categoryId!: string;

  @ApiProperty({
    description:
      'Arithmetic sum of the in-range expense amounts for this category as a ' +
      'two-decimal string (numeric sum across currencies; no conversion, A2).',
    example: '250.00',
  })
  total!: string;
}

/**
 * By-category spending insight (Req 11.2, 11.4, 11.5).
 *
 * `categories` contains one entry per category that has at least one expense in
 * the range; each `total` is the arithmetic sum of that category's in-range
 * amounts as a two-decimal STRING (design ADR-5). When nothing matches, the
 * array is empty and no error is returned (Req 11.4, Property 4).
 *
 * Entries are ordered by `categoryId` ascending for a deterministic response.
 */
export class CategoryInsightResponse {
  @ApiProperty({
    description: 'The inclusive range start the insight was computed for.',
    example: '2024-01-01',
  })
  startDate!: string;

  @ApiProperty({
    description: 'The inclusive range end the insight was computed for.',
    example: '2024-01-31',
  })
  endDate!: string;

  @ApiProperty({
    description: 'Per-category totals (empty when nothing matched).',
    type: [CategoryTotal],
  })
  categories!: CategoryTotal[];
}
