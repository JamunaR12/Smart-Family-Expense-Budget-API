import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { IsCalendarDate } from '../../expenses/dto/expense-date.validator';

/**
 * By-category insight query contract (Req 11.2, 11.6).
 *
 * Req 11.2 computes a grouped total "for a specified time range", so BOTH
 * `startDate` and `endDate` are REQUIRED. Each is a strict `YYYY-MM-DD`
 * calendar date (reusing `IsCalendarDate` from the expenses module); a missing
 * or malformed bound is rejected by the global `ValidationPipe`, naming the
 * field and computing NO insight (Req 11.6, Property 5).
 *
 * The cross-field rule `startDate <= endDate` is enforced in the service so a
 * single, clear invalid-range error can be raised (mirrors ExpensesService).
 */
export class CategoryInsightQueryDto {
  @ApiProperty({
    description: 'Inclusive range start (YYYY-MM-DD).',
    example: '2024-01-01',
  })
  @IsNotEmpty({ message: 'startDate is required' })
  @IsCalendarDate()
  startDate!: string;

  @ApiProperty({
    description: 'Inclusive range end (YYYY-MM-DD).',
    example: '2024-01-31',
  })
  @IsNotEmpty({ message: 'endDate is required' })
  @IsCalendarDate()
  endDate!: string;
}
