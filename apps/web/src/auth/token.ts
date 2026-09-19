/**
 * Centralized access-token provider for the API client.
 *
 * The API client never reaches into React state directly. An auth provider
 * registers one async getter here, and `openapi-fetch` middleware asks for a
 * token on each request. Tokens are never written to localStorage by this
 * module.
 */
type TokenProvider = () => Promise<string | null>;

let provider: TokenProvider | null = null;

/** Registers the current token getter. */
export function setAccessTokenProvider(next: TokenProvider | null): void {
  provider = next;
}

/** Returns a token for an API request, or `null` when unavailable. */
export async function getAccessTokenForRequest(): Promise<string | null> {
  if (!provider) {
    return null;
  }
  try {
    const token = await provider();
    return token && token.length > 0 ? token : null;
  } catch {
    // Anonymous or expired session: send the request without a token.
    return null;
  }
}
