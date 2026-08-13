import { BeecodeError, ErrorCodes } from "@beecode/protocol";

export interface IdentityProviderStartInput {
  callbackUrl: string;
  state: string;
  loginHint?: string;
}

export interface IdentityProviderProfile {
  subject: string;
  displayName?: string;
}

export interface IdentityProvider {
  readonly name: string;
  createAuthorizationUrl(input: IdentityProviderStartInput): string;
  exchangeCode(code: string): Promise<IdentityProviderProfile>;
}

/**
 * Deterministic local provider for development and automated tests.
 * It never leaves the Beecode origin and must not be enabled in production.
 */
export class DevelopmentIdentityProvider implements IdentityProvider {
  readonly name = "development";

  createAuthorizationUrl(input: IdentityProviderStartInput): string {
    const profile = {
      subject: input.loginHint?.trim() || "developer@example.test",
      displayName: "Beecode Developer",
    };
    const code = Buffer.from(JSON.stringify(profile), "utf8").toString("base64url");
    const callback = new URL(input.callbackUrl);
    callback.searchParams.set("code", `dev_${code}`);
    callback.searchParams.set("state", input.state);
    return callback.toString();
  }

  async exchangeCode(code: string): Promise<IdentityProviderProfile> {
    if (!code.startsWith("dev_")) {
      throw new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "Development identity code is invalid");
    }
    try {
      const decoded: unknown = JSON.parse(
        Buffer.from(code.slice("dev_".length), "base64url").toString("utf8"),
      );
      if (
        typeof decoded !== "object" ||
        decoded === null ||
        !("subject" in decoded) ||
        typeof decoded.subject !== "string" ||
        decoded.subject.length === 0
      ) {
        throw new TypeError("Identity profile is invalid");
      }
      const displayName =
        "displayName" in decoded && typeof decoded.displayName === "string"
          ? decoded.displayName
          : undefined;
      return displayName
        ? { subject: decoded.subject, displayName }
        : { subject: decoded.subject };
    } catch (error: unknown) {
      throw new BeecodeError(
        ErrorCodes.AUTHORIZATION_DENIED,
        "Development identity code is invalid",
        false,
      );
    }
  }
}
