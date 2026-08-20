import { BeecodeError, ErrorCodes } from "@beecode/protocol";

export class RuntimeTokenStore {
  private accessToken: string | undefined;

  update(accessToken: string | undefined): void {
    this.accessToken = accessToken;
  }

  clear(): void {
    this.accessToken = undefined;
  }

  require(): string {
    if (!this.accessToken) {
      throw new BeecodeError(ErrorCodes.UNAUTHENTICATED, "Desktop login is required");
    }
    return this.accessToken;
  }
}

export function createAuthenticatedFetch(
  tokens: RuntimeTokenStore,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${tokens.require()}`);
    return fetchImpl(input, { ...init, headers });
  };
}
