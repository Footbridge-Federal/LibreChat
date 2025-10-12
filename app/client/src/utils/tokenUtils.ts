interface TokenPayload {
  exp: number;
  userId: string;
  [key: string]: any;
}

/**
 * Decodes a JWT token to extract the payload
 */
export function decodeToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch (error) {
    console.error('Failed to decode token:', error);
    return null;
  }
}

/**
 * Checks if a JWT token is expired
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeToken(token);
  if (!payload || !payload.exp) {
    return true;
  }

  // Check if token expires within the next 5 seconds (buffer for network latency)
  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= (now + 5);
}

/**
 * Gets token expiration time in seconds
 */
export function getTokenExpiration(token: string): number | null {
  const payload = decodeToken(token);
  return payload?.exp || null;
}