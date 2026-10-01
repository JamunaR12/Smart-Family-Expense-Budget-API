import { NotFoundException } from '@nestjs/common';
import * as fc from 'fast-check';
import {
  assertOwnership,
  NOT_FOUND_CODE,
} from '../../src/common/guards/ownership.guard';

/**
 * // Feature: smart-expense-insights-platform, Property 6
 *
 * Property 6: Data isolation — single-resource access and mutation
 * (Req 3.1, 3.2, 5.8, 6.6, 7.3, 8.6, 9.9, 10.4).
 *
 * PURE / NO-DB. The single-resource authorization decision is centralized in
 * the {@link assertOwnership} helper (used by `OwnershipGuard` and services for
 * every `/:id` read/update/delete). This property verifies that decision
 * across arbitrary user pairs and resources:
 *  - for two DISTINCT users A and B and any resource owned by A, `assertOwnership`
 *    invoked as B is DENIED with the non-disclosing NOT_FOUND response, and it
 *    returns NO data belonging to A (it throws, leaking nothing);
 *  - the owner A is always granted and receives the resource unchanged.
 *
 * "Not owned" and "not found" collapse to the SAME response so existence is not
 * disclosed (Req 3.2).
 *
 * TODO (Phases 4-6): the HTTP-level end-to-end version of this property — a real
 * request by user B to GET/PATCH/DELETE user A's expense/category/budget over
 * Supertest returning 404 and leaving the row unchanged — is completed when the
 * expenses/categories/budgets endpoints land. This helper-level property proves
 * the shared authorization primitive those routes delegate to.
 */
describe('Property 6 — data isolation, single-resource access/mutation (Req 3.1, 3.2)', () => {
  it('denies a non-owner and grants the owner for arbitrary user pairs', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        // A generic owner-scoped resource; the field the helper checks is
        // `userId`, which we pin to the owner (userA) below.
        fc.record({
          id: fc.uuid(),
          // Arbitrary "contents" that must never leak to a non-owner. Prefixed
          // with a distinctive marker so the leak check is meaningful and not
          // confused by incidental whitespace/short strings that could appear
          // in a generic message.
          amount: fc.string().map((s) => `SECRET_CONTENT_${s}`),
        }),
        (userA, userB, base) => {
          // Require two DISTINCT users (skip the degenerate equal case).
          fc.pre(userA !== userB);
          const resource = { ...base, userId: userA };

          // Owner A: granted, resource returned unchanged.
          const granted = assertOwnership(resource, userA);
          expect(granted).toBe(resource);

          // Non-owner B: denied with the non-disclosing NOT_FOUND envelope.
          let denied = false;
          let leaked: unknown;
          try {
            leaked = assertOwnership(resource, userB);
          } catch (error) {
            denied = true;
            expect(error).toBeInstanceOf(NotFoundException);
            const response = (error as NotFoundException).getResponse() as {
              code: unknown;
              message: unknown;
            };
            expect(response.code).toBe(NOT_FOUND_CODE);
            // The response carries only a generic message — no resource data.
            const serialized = JSON.stringify(response);
            expect(serialized).not.toContain(resource.amount);
            expect(serialized).not.toContain('SECRET_CONTENT_');
            expect(serialized).not.toContain(resource.id);
          }
          expect(denied).toBe(true);
          expect(leaked).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('denies access to a non-existent resource identically (existence not disclosed)', () => {
    fc.assert(
      fc.property(fc.uuid(), (userId) => {
        // A missing resource (null/undefined) yields the SAME NOT_FOUND response
        // a non-owner gets, so "does not exist" is indistinguishable from
        // "belongs to someone else" (Req 3.2).
        for (const missing of [null, undefined]) {
          try {
            assertOwnership(missing, userId);
            throw new Error('expected assertOwnership to throw');
          } catch (error) {
            expect(error).toBeInstanceOf(NotFoundException);
            const response = (error as NotFoundException).getResponse() as {
              code: unknown;
            };
            expect(response.code).toBe(NOT_FOUND_CODE);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
