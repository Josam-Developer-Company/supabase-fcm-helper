export type ReminderInput = {
  title: string;
  message: string;
  frequency: "weekly" | "monthly";
  days: number[];
  local_time: string;
  include_limited: boolean;
};

export function validateReminder(value: unknown): ReminderInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid reminder");
  }
  const v = value as Record<string, unknown>;
  const title = typeof v.title === "string" ? v.title.trim() : "";
  const message = typeof v.message === "string" ? v.message.trim() : "";
  if (
    [...title].length < 1 || [...title].length > 80 ||
    [...message].length < 1 || [...message].length > 400
  ) {
    throw new Error("Title or message length is invalid");
  }
  if (v.frequency !== "weekly" && v.frequency !== "monthly") {
    throw new Error("Invalid frequency");
  }
  const max = v.frequency === "weekly" ? 7 : 31;
  if (
    !Array.isArray(v.days) || v.days.length < 1 || v.days.length > max ||
    v.days.some((d) => !Number.isInteger(d) || d < 1 || d > max)
  ) throw new Error("Invalid days");
  if (
    typeof v.local_time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(v.local_time)
  ) {
    throw new Error("Invalid local time");
  }
  if (typeof v.include_limited !== "boolean") {
    throw new Error("Invalid limited member setting");
  }
  return {
    title,
    message,
    frequency: v.frequency,
    days: [...new Set(v.days)].sort((a, b) => a - b),
    local_time: v.local_time.slice(0, 5),
    include_limited: v.include_limited,
  };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
}

export type DevicePushResult = {
  status: "sent" | "retry" | "failed" | "unreachable";
  error?: string;
};
export function classifyReminderFcmResponse(
  status: number,
  body: string,
): DevicePushResult {
  if (status >= 200 && status < 300) return { status: "sent" };
  let code = "";
  try {
    const parsed = JSON.parse(body);
    const detail = parsed?.error?.details?.find((d: { "@type"?: string }) =>
      d["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError"
    );
    code = detail?.errorCode ?? "";
  } catch {
    /* Non-JSON gateway responses are still classified by HTTP status. */
  }
  if (["UNREGISTERED", "SENDER_ID_MISMATCH"].includes(code)) {
    return { status: "unreachable", error: code };
  }
  // Store only a bounded status/code, never the request body or token.
  const error = `FCM ${status}${code ? ": " + code : ""}`;
  return {
    status: status === 408 || status === 429 || status >= 500
      ? "retry"
      : "failed",
    error,
  };
}
