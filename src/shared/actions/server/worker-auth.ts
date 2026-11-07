import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Checks `Authorization: Bearer <secret>` in constant time, so that the
 * comparison does not leak how much of the secret was guessed.
 */
export function isAuthorizedWorkerRequest(
  authorizationHeader: string | null,
  expectedSecret: string,
): boolean {
  const prefix = "Bearer ";
  if (!authorizationHeader?.startsWith(prefix)) return false;

  const given = Buffer.from(authorizationHeader.slice(prefix.length));
  const expected = Buffer.from(expectedSecret);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
