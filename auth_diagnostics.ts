// Never include provider messages, JWTs, headers or user identifiers in diagnostics.
export type AuthFailure = {
  code: string;
  status: number;
  retryable: boolean;
  providerCode: string;
  providerStatus: number | null;
};

export function classifyAuthFailure(
  error: unknown,
  authorization: string | null,
): AuthFailure {
  const value = error && typeof error === "object"
    ? error as { code?: unknown; status?: unknown }
    : {};
  const allowedCodes = new Set([
    "bad_jwt",
    "session_expired",
    "session_not_found",
    "user_not_found",
    "user_banned",
    "no_authorization",
    "unexpected_audience",
    "over_request_rate_limit",
    "request_timeout",
    "unexpected_failure",
    "insufficient_aal",
  ]);
  const providerCode =
    typeof value.code === "string" && allowedCodes.has(value.code)
      ? value.code
      : "unknown";
  const providerStatus = typeof value.status === "number" &&
      Number.isInteger(value.status) && value.status >= 100 &&
      value.status <= 599
    ? value.status
    : null;
  let code = "AUTH_REJECTED";
  let status = 401;
  let retryable = false;
  if (!authorization?.trim()) code = "AUTH_HEADER_MISSING";
  else if (!/^Bearer\s+\S+$/i.test(authorization.trim())) {
    code = "AUTH_HEADER_INVALID";
  } else if (
    providerStatus === 429 || providerCode === "over_request_rate_limit"
  ) {
    code = "AUTH_RATE_LIMITED";
    status = 429;
    retryable = true;
  } else if (
    (providerStatus === null && error != null && providerCode === "unknown") ||
    providerStatus === 408 ||
    providerCode === "request_timeout" ||
    providerCode === "unexpected_failure" ||
    (providerStatus !== null && providerStatus >= 500)
  ) {
    code = "AUTH_SERVICE_UNAVAILABLE";
    status = 503;
    retryable = true;
  } else {
    const codes: Record<string, string> = {
      bad_jwt: "AUTH_TOKEN_INVALID",
      session_expired: "AUTH_SESSION_EXPIRED",
      session_not_found: "AUTH_SESSION_NOT_FOUND",
      user_not_found: "AUTH_USER_NOT_FOUND",
      user_banned: "AUTH_USER_BANNED",
    };
    code = codes[providerCode] ?? code;
  }
  return { code, status, retryable, providerCode, providerStatus };
}

// Catch transport failures too; otherwise they fall into an unrelated generic 500.
export async function inspectAuthUser<T>(
  getUser: () => Promise<{
    data: { user: T | null };
    error: unknown;
  }>,
): Promise<{ data: { user: T | null }; error: unknown }> {
  try {
    return await getUser();
  } catch (error) {
    return { data: { user: null }, error };
  }
}

export function authFailureResponse(
  failure: AuthFailure,
  requestId: string,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: failure.retryable
        ? "Authentication service temporarily unavailable"
        : "Unauthorized",
      code: failure.code,
      retryable: failure.retryable,
      request_id: requestId,
    }),
    {
      status: failure.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
    },
  );
}
