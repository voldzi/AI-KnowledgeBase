import "server-only";

import { Effect } from "effect";
import type { NextResponse } from "next/server";

export function runRouteEffect<Failure>(
  program: Effect.Effect<NextResponse, Failure, never>,
  onFailure: (failure: Failure) => NextResponse
): Promise<NextResponse> {
  return Effect.runPromise(Effect.catchAll(program, (failure) => Effect.succeed(onFailure(failure))));
}
