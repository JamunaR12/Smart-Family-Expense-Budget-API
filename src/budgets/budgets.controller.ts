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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import {
  BudgetResponse,
  BudgetStatusResponse,
  DeleteBudgetResponse,
} from './dto/budget-response';
import { ErrorResponse } from '../auth/dto/auth-responses';

/**
 * Budget HTTP boundary (Req 9, 10).
 *
 * Served under `/api/v1/budgets`. Every route is protected by the global
 * `JwtAuthGuard` (NOT `@Public()`), and each service call is scoped to
 * `currentUser.id` for Data_Isolation (Req 3.3). The controller only binds and
 * delegates; all business rules live in `BudgetsService`.
 */
@ApiTags('budgets')
@ApiBearerAuth()
@Controller({ path: 'budgets', version: '1' })
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  /** Creates a budget owned by the caller (Req 9.1-9.5). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a budget',
    description:
      'Creates a budget owned by the authenticated user. The limit must be ' +
      '0.01-999,999,999.99 with at most two decimals, the period one of ' +
      'weekly/monthly/yearly, and the optional category must be owned by the ' +
      'user.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Budget created.',
    type: BudgetResponse,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'VALIDATION_ERROR — invalid limitAmount/period, or category not accessible.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'AUTH_REQUIRED / AUTH_FAILED — missing or invalid token.',
    type: ErrorResponse,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBudgetDto,
  ): Promise<BudgetResponse> {
    return this.budgets.create(user.id, dto);
  }

  /** Lists the caller's budgets (Req 9.6). */
  @Get()
  @ApiOperation({
    summary: 'List budgets',
    description:
      "Returns the authenticated user's budgets (empty list when none).",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "A list of the user's budgets.",
    type: [BudgetResponse],
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'AUTH_REQUIRED / AUTH_FAILED — missing or invalid token.',
    type: ErrorResponse,
  })
  list(@CurrentUser() user: AuthenticatedUser): Promise<BudgetResponse[]> {
    return this.budgets.findMany(user.id);
  }

  /** Returns the status/tracking of an owned budget (Req 10). */
  @Get(':id/status')
  @ApiOperation({
    summary: 'Get budget status',
    description:
      'Computes the total in-scope, in-period spend for an owned budget, the ' +
      'remaining amount, and whether spending is within-limit or exceeded. A ' +
      'missing or non-owned budget returns 404.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Identifier of the budget to evaluate.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: BudgetStatusResponse })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'AUTH_REQUIRED / AUTH_FAILED — missing or invalid token.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND — the budget does not exist or is not owned.',
    type: ErrorResponse,
  })
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<BudgetStatusResponse> {
    return this.budgets.getStatus(user.id, id);
  }

  /** Updates an owned budget (Req 9.7, 9.9). */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update a budget',
    description:
      'Applies a partial update to an owned budget. Any provided field is ' +
      'validated with the same rules as create; invalid input leaves the ' +
      'stored budget unchanged. A missing or non-owned budget returns 404.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Identifier of the budget to update.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: BudgetResponse })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'VALIDATION_ERROR — invalid limitAmount/period, or category not accessible.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'AUTH_REQUIRED / AUTH_FAILED — missing or invalid token.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND — the budget does not exist or is not owned.',
    type: ErrorResponse,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateBudgetDto,
  ): Promise<BudgetResponse> {
    return this.budgets.update(user.id, id, dto);
  }

  /** Deletes an owned budget (Req 9.8, 9.9). */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a budget',
    description:
      'Removes an owned budget and returns a confirmation. A missing or ' +
      'non-owned budget returns 404 and no budget is removed.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Identifier of the budget to delete.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Budget deleted.',
    type: DeleteBudgetResponse,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'AUTH_REQUIRED / AUTH_FAILED — missing or invalid token.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND — the budget does not exist or is not owned.',
    type: ErrorResponse,
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ deleted: true; id: string }> {
    return this.budgets.remove(user.id, id);
  }
}
