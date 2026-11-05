import { inactivityEmailHtml } from "./inactive_account_emails.ts";

export type ProjectLeaveNotification = {
  owner_email: string;
  language: string;
  member_name: string;
  project_name: string;
  project_id: string;
  left_at: string;
};

export function renderProjectLeaveEmail(
  job: ProjectLeaveNotification,
  appUrl: string,
) {
  const url = new URL(appUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Invalid WEB_APP_URL");
  }
  url.search = "";
  url.hash = "/calendar?" + new URLSearchParams({ project: job.project_id });
  const it = job.language !== "en";
  const member = job.member_name.trim() || (it ? "Un membro" : "A member");
  const project = job.project_name.trim() || (it ? "Progetto" : "Project");
  const date = new Intl.DateTimeFormat(it ? "it-IT" : "en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(new Date(job.left_at)) + (it ? " (ora italiana)" : " (Italy time)");
  const title = it
    ? "Un membro ha abbandonato il progetto"
    : "A member has left your project";
  const text = it
    ? `${member} ha abbandonato il progetto “${project}” il ${date}. Non fa più parte dei suoi gruppi e non ha più accesso al calendario del progetto.`
    : `${member} left “${project}” on ${date}. They are no longer in any of its groups and no longer have access to the project calendar.`;
  const notice = it
    ? "Gli eventi condivisi sono stati conservati e quelli creati dalla persona sono stati riassegnati a te. Le sue indisponibilità personali restano private. Ricevi questa email perché sei il proprietario del progetto."
    : "Shared events have been kept and events created by this person have been reassigned to you. Their personal unavailability remains private. You received this email because you own the project.";
  const label = it ? "Apri il progetto" : "Open project";
  const clean = (value: string) =>
    value.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ");
  return {
    subject: clean(
      it
        ? `${member} ha abbandonato “${project}” · Band Calendar`
        : `${member} left “${project}” · Band Calendar`,
    ),
    htmlContent: inactivityEmailHtml({
      title,
      text,
      language: job.language,
      notice,
      action: { url: url.toString(), label },
      address: { label: it ? "PROGETTO" : "PROJECT", value: project },
    }).replace(
      it ? "SICUREZZA DEL TUO ACCOUNT" : "YOUR ACCOUNT SECURITY",
      it ? "AGGIORNAMENTO DEL PROGETTO" : "PROJECT UPDATE",
    ),
    textContent: [
      title,
      text,
      notice,
      `${label}: ${url}`,
      it
        ? "Buona musica,\nIl team di Band Calendar"
        : "Keep making music,\nThe Band Calendar team",
      "info@bandcalendar.eu",
    ].join("\n\n"),
  };
}

export async function sendProjectLeaveEmail(
  notification: unknown,
  config: {
    apiUrl?: string;
    apiKey?: string;
    sender?: string;
    appUrl?: string;
  },
  request: typeof fetch = fetch,
) {
  if (!config.apiUrl || !config.apiKey || !config.sender || !config.appUrl) {
    throw new Error("Missing mail configuration");
  }
  const job = notification as ProjectLeaveNotification;
  if (
    !job || typeof job.owner_email !== "string" ||
    !job.owner_email.includes("@")
  ) {
    throw new Error("Missing owner email");
  }
  const mail = renderProjectLeaveEmail(job, config.appUrl);
  const response = await request(config.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": config.apiKey },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      sender: { name: "Band Calendar", email: config.sender },
      to: [{ email: job.owner_email }],
      ...mail,
      tags: ["project_member_left", job.project_id],
    }),
  });
  // Do not retry uncertain delivery automatically: avoid duplicate emails.
  if (!response.ok) throw new Error("Owner email delivery failed");
  await response.body?.cancel();
}
