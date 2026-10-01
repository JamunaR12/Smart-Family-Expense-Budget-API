import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { IsMonth } from './month.validator';

/**
 * Monthly insight query contract (Req 11.1, 11.6).
 *
 * `month` is REQUIRED and must be a strict `YYYY-MM` value with month 01-12.
 * A missing or malformed month is rejected by the global `ValidationPipe`,
 * naming the `month` field and computing NO insight (Req 11.6, Property 5).
 */
export class MonthlyInsightQueryDto {
  @ApiProperty({
    description: 'Target month (YYYY-MM).',
    example: '2024-01',
  })
  @IsNotEmpty({ message: 'month is required' })
  @IsMonth()
  month!: string;
}
