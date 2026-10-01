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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import {
  CategoryResponse,
  DeleteCategoryResponse,
} from './dto/category-response';
import { ErrorResponse } from '../auth/dto/auth-responses';

/**
 * Category HTTP boundary (Req 8).
 *
 * Served under `/api/v1/categories`. Every route is protected by the global
 * `JwtAuthGuard` (NOT `@Public()`), and each service call is scoped to
 * `currentUser.id` for Data_Isolation (Req 3.3). The controller only binds and
 * delegates; all business rules live in `CategoriesService`.
 */
@ApiTags('categories')
@ApiBearerAuth()
@Controller({ path: 'categories', version: '1' })
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** Creates a category owned by the caller (Req 8.1-8.3). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a category',
    description:
      'Creates a category owned by the authenticated user. The name is ' +
      'trimmed and must be 1-100 characters and unique (case-insensitive) ' +
      "among the user's categories.",
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Category created.',
    type: CategoryResponse,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'VALIDATION_ERROR — name is empty/whitespace or too long.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'AUTH_REQUIRED / AUTH_FAILED — missing or invalid token.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'CONFLICT — a category with this name already exists.',
    type: ErrorResponse,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryResponse> {
    return this.categories.create(user.id, dto);
  }

  /** Lists the caller's categories (Req 8.4). */
  @Get()
  @ApiOperation({
    summary: 'List categories',
    description:
      "Returns the authenticated user's categories (empty list when none).",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "A list of the user's categories.",
    type: [CategoryResponse],
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'AUTH_REQUIRED / AUTH_FAILED — missing or invalid token.',
    type: ErrorResponse,
  })
  list(@CurrentUser() user: AuthenticatedUser): Promise<CategoryResponse[]> {
    return this.categories.findMany(user.id);
  }

  /** Updates an owned category's name (Req 8.5, 8.6). */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update a category',
    description:
      'Renames an owned category. The new name is trimmed and must be 1-100 ' +
      "characters and unique (case-insensitive) among the user's other " +
      'categories. A missing or non-owned category returns 404.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Identifier of the category to update.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: CategoryResponse })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'VALIDATION_ERROR — name is empty/whitespace or too long.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'AUTH_REQUIRED / AUTH_FAILED — missing or invalid token.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'CONFLICT — a category with this name already exists.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND — the category does not exist or is not owned.',
    type: ErrorResponse,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
    return this.categories.update(user.id, id, dto);
  }

  /** Deletes an owned category when unreferenced (Req 8.6, 8.7, 8.8). */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a category',
    description:
      'Removes an owned category. Deletion is rejected with a conflict when ' +
      'the category is referenced by one or more expenses. A missing or ' +
      'non-owned category returns 404.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Identifier of the category to delete.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Category deleted.',
    type: DeleteCategoryResponse,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'AUTH_REQUIRED / AUTH_FAILED — missing or invalid token.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'CONFLICT — the category is referenced by existing expenses.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'NOT_FOUND — the category does not exist or is not owned.',
    type: ErrorResponse,
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ deleted: true; id: string }> {
    return this.categories.remove(user.id, id);
  }
}
