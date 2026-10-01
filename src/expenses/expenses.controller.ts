import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { ExpensesService, ExpenseListResult } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import {
  DeleteExpenseResponse,
  ExpenseListResponse,
  ExpenseResponse,
} from './dto/expense-response';
import { ErrorResponse } from '../auth/dto/auth-responses';

/**
 * Expense HTTP boundary (Req 4-7).
 *
 * Served under `/api/v1/expenses` (global prefix + URI versioning). Every route
 * is protected by the global `JwtAuthGuard` (NOT `@Public()`), so an
 * unauthenticated request is rejected with 401 before reaching the handler
 * (Req 5.9). The authenticated principal is injected via `@CurrentUser()` and
 * every service call is scoped to `currentUser.id` for Data_Isolation (Req 3.3).
 *
 * The controller only binds and delegates; all business rules live in
 * `ExpensesService`.
 */
@ApiTags('expenses')
@ApiBearerAuth()
@Controller({ path: 'expenses', version: '1' })
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  /** Creates an expense owned by the caller (Req 4). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an expense',
    description:
      'Creates an expense owned by the authenticated user. The amount must be ' +
      '0.01-999,999,999.99 with at most two decimals, the currency a valid ISO ' +
      '4217 code, the date a valid non-future calendar date, and the category ' +
      'must be owned by the user.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Expense created.',
    type: ExpenseResponse,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'VALIDATION_ERROR — a field failed validation (amount/currency/date/' +
      'description) or the category is invalid/not owned.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'AUTH_REQUIRED / AUTH_FAILED — missing or invalid token.',
    type: ErrorResponse,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExpenseDto,
  ): Promise<ExpenseResponse> {
    return this.expenses.create(user.id, dto);
  }

  /** Lists the caller's expenses with filters, ordering, and pagination (Req 5). */
  @Get()
  @ApiOperation({
    summary: 'List expenses',
    description:
      "Returns the authenticated user's expenses ordered by date descending. " +
      'Supports inclusive date-range (startDate/endDate), category filter, and ' +
      'pagination (limit 1-100 default 20, offset >= 0 default 0).',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Inclusive lower date bound (YYYY-MM-DD).',
    example: '2024-01-01',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Inclusive upper date bound (YYYY-MM-DD).',
    example: '2024-01-31',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    format: 'uuid',
    description: 'Filter to a single category owned by the user.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Page size (1-100). Defaults to 20.',
    example: 20,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Result offset (>= 0). Defaults to 0.',
    example: 0,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "A paginated list of the user's expenses (empty when none).",
    type: ExpenseListResponse,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'VALIDATION_ERROR — a pagination, date-range, or category parameter is ' +
      'malformed or out of range.',
    type: ErrorResponse,
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListExpensesQueryDto,
  ): Promise<ExpenseListResult> {
    return this.expenses.findMany(user.id, query);
  }

  /** Returns a single owned expense (Req 5.1, 5.7, 5.8). */
  @Get(':id')
  @ApiOperation({
    summary: 'Get an expense by id',
    description:
      'Returns a single expense owned by the user. A missing expense and one ' +
      'owned by another user both return the same 404 (existence is not ' +
      'disclosed).',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Identifier of the expense to retrieve.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ExpenseResponse })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND — the expense does not exist or is not owned.',
    type: ErrorResponse,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ExpenseResponse> {
    return this.expenses.findOne(user.id, id);
  }

  /** Updates an owned expense (Req 6). */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update an expense',
    description:
      'Applies a partial update to an owned expense. Any provided field is ' +
      'validated with the same rules as create; invalid input leaves the ' +
      'stored expense unchanged. A missing or non-owned expense returns 404.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Identifier of the expense to update.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ExpenseResponse })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'VALIDATION_ERROR — an invalid field or invalid category.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND — the expense does not exist or is not owned.',
    type: ErrorResponse,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateExpenseDto,
  ): Promise<ExpenseResponse> {
    return this.expenses.update(user.id, id, dto);
  }

  /** Deletes an owned expense (Req 7). */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete an expense',
    description:
      'Removes an owned expense and returns a confirmation. A missing or ' +
      'non-owned expense returns 404 and no expense is removed.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Identifier of the expense to delete.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Expense deleted.',
    type: DeleteExpenseResponse,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND — the expense does not exist or is not owned.',
    type: ErrorResponse,
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ deleted: true; id: string }> {
    return this.expenses.remove(user.id, id);
  }
}
