import { BeecodeError, ErrorCodes } from "@beecode/protocol";

export const CLI_OAUTH_CLIENT_ID = "beecode-cli";
export const IOS_OAUTH_CLIENT_ID = "beecode-ios";

export interface OAuthClientRegistration {
  clientId: string;
  displayName: string;
  consentTitle: string;
  consentDescription: string;
}

export class OAuthClientRegistry {
  constructor(private readonly iosRedirectUri: string) {}

  validateAuthorizationRequest(
    clientId: string,
    redirectUri: string,
    challenge: string,
  ): OAuthClientRegistration {
    const client = this.requireClient(clientId);
    validatePKCEChallenge(challenge);
    if (clientId === CLI_OAUTH_CLIENT_ID) {
      validateCLIRedirectUri(redirectUri);
    } else if (redirectUri !== this.iosRedirectUri) {
      throw new BeecodeError(
        ErrorCodes.AUTHORIZATION_DENIED,
        "iOS redirect URI must exactly match the registered callback",
      );
    }
    return client;
  }

  requireClient(clientId: string): OAuthClientRegistration {
    if (clientId === CLI_OAUTH_CLIENT_ID) {
      return {
        clientId,
        displayName: "Beecode CLI",
        consentTitle: "授权此命令行客户端？",
        consentDescription: "CLI 将使用你的 Beecode 账号和共享额度，但无法访问其他端的会话。",
      };
    }
    if (clientId === IOS_OAUTH_CLIENT_ID) {
      return {
        clientId,
        displayName: "Beecode iOS",
        consentTitle: "授权 Beecode iOS？",
        consentDescription: "iOS App 将使用你的 Beecode 账号和共享额度，但只能访问 iOS 会话。",
      };
    }
    throw new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "OAuth client is not registered");
  }
}

function validateCLIRedirectUri(redirectUri: string): void {
  const redirect = new URL(redirectUri);
  const isLoopback = redirect.hostname === "127.0.0.1" || redirect.hostname === "[::1]";
  if (redirect.protocol !== "http:" || !isLoopback || redirect.pathname !== "/callback") {
    throw new BeecodeError(
      ErrorCodes.AUTHORIZATION_DENIED,
      "CLI redirect URI must be an exact loopback callback",
    );
  }
}

function validatePKCEChallenge(challenge: string): void {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "PKCE S256 challenge is invalid");
  }
}
