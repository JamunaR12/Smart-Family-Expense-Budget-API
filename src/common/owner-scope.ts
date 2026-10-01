/**
 * Owner-scoped query pattern (Data_Isolation, Req 3.1, 3.2, 3.3).
 *
 * This is the PRIMARY isolation mechanism in the design: every read and write
 * performed by a resource service filters by `userId = currentUser.id`. As a
 * result:
 * - list/collection queries only ever return the owner's records, and return
 *   `[]` when the user owns none (Req 3.3, Property 7);
 * - single-resource reads/updates/deletes that add `userId` to the `where`
 *   clause naturally return "not found" for a resource owned by someone else,
 *   never disclosing its existence (Req 3.2, Property 6).
 *
 * The `OwnershipGuard` / `assertOwnership()` backstop covers `/:id` routes.
 *
 * Usage convention for services (Phases 4-6):
 *
 * ```ts
 * // List — owner-scoped, empty when none:
 * this.prisma.expense.findMany({ where: ownerScope(userId) });
 *
 * // Single resource — owner-scoped where clause hides non-owned resources:
 * this.prisma.expense.findFirst({ where: { id, ...ownerScope(userId) } });
 * ```
 */

/**
 * Builds the owner-scoping fragment merged into a Prisma `where` clause so a
 * query only ever touches the authenticated user's records.
 *
 * @param userId the authenticated user's id (`currentUser.id`)
 */
export function ownerScope(userId: string): { userId: string } {
  return { userId };
}
