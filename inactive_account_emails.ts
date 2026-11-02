// Publish this file at the root of Giupy93/supabase-fcm-helper before deploying
// process-inactive-accounts. Keep the account-recovery email style in sync.
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (
      c,
    ) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]!),
  );

function inactivityEmailHtml(options: {
  title: string;
  text: string;
  language: string;
  action?: { url: string; label: string };
  address?: { label: string; value: string };
  notice: string;
}) {
  const it = options.language !== "en";
  const title = escapeHtml(options.title), text = escapeHtml(options.text);
  const eyebrow = it ? "SICUREZZA DEL TUO ACCOUNT" : "YOUR ACCOUNT SECURITY";
  const greeting = it ? "Buona musica," : "Keep making music,";
  const team = it ? "Il team di Band Calendar" : "The Band Calendar team";
  const slogan = it
    ? "I tuoi progetti. La tua musica. Un unico calendario."
    : "Your projects. Your music. One calendar.";
  const help = it ? "Hai domande?" : "Have questions?";
  const fallback = it
    ? "Se il pulsante non funziona, copia e incolla il link nel browser:"
    : "If the button does not work, copy and paste this link into your browser:";
  const address = options.address
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 24px;background-color:#eff5ff;border-radius:10px;">
            <tr><td style="padding:18px 20px;">
              <p style="margin:0 0 8px;font-size:11px;line-height:18px;letter-spacing:1px;color:#58667c;">${
      escapeHtml(options.address.label)
    }</p>
              <p style="margin:0;font-size:15px;line-height:25px;font-weight:bold;color:#172338;word-break:normal;overflow-wrap:anywhere;">${
      escapeHtml(options.address.value)
    }</p>
            </td></tr>
          </table>`
    : "";
  const button = options.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
            <tr><td bgcolor="#136dec" style="background-color:#136dec;border-radius:8px;text-align:center;mso-padding-alt:14px 20px;">
              <a href="${
      escapeHtml(options.action.url)
    }" target="_blank" style="display:inline-block;padding:14px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${
      escapeHtml(options.action.label)
    } &nbsp;→</a>
            </td></tr>
          </table>`
    : "";
  const fallbackLink = options.action
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
        <tr><td align="center" style="padding:18px 12px 0;">
          <p style="margin:0 0 6px;font-size:11px;line-height:18px;color:#58667c;">${fallback}</p>
          <a href="${
      escapeHtml(options.action.url)
    }" target="_blank" style="font-size:12px;line-height:20px;color:#136dec;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${
      escapeHtml(options.action.url)
    }</a>
        </td></tr>
      </table>`
    : "";
  return `<!DOCTYPE html>
<html lang="${it ? "it" : "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>Band Calendar - ${title}</title>
  <style>
    @media only screen and (max-width:480px) {
      .bc-pad { padding-left:22px !important; padding-right:22px !important; }
      .bc-title { font-size:27px !important; line-height:33px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f3f6fb;color:#172338;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${title}. ${text}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f3f6fb;">
    <tr><td align="center" style="padding:28px 12px;">
      <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #e5eaf1;border-top:4px solid #136dec;border-radius:14px;">
        <tr><td class="bc-pad" style="padding:27px 34px 22px;font-size:18px;line-height:26px;font-weight:bold;letter-spacing:-0.4px;color:#172338;">Band Calendar</td></tr>
        <tr><td class="bc-pad" style="padding:12px 34px 30px;">
          <p style="margin:0 0 12px;font-size:11px;line-height:18px;font-weight:bold;letter-spacing:1.3px;color:#136dec;">${eyebrow}</p>
          <h1 class="bc-title" style="margin:0 0 22px;font-size:30px;line-height:36px;letter-spacing:-1px;color:#172338;">${title}</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:25px;">${text}</p>
          ${address}
          ${button}
          <p style="margin:0 0 26px;font-size:12px;line-height:20px;color:#58667c;">${
    escapeHtml(options.notice)
  }</p>
          <p style="margin:0;font-size:13px;line-height:22px;color:#172338;">${greeting}<br><strong>${team}</strong></p>
        </td></tr>
        <tr><td class="bc-pad" style="padding:22px 34px;background-color:#f7f9fc;border-top:1px solid #e5eaf1;border-radius:0 0 14px 14px;">
          <p style="margin:0 0 5px;font-size:12px;line-height:20px;color:#58667c;">${slogan}</p>
          <p style="margin:0;font-size:11px;line-height:18px;color:#58667c;">${help} <a href="mailto:info@bandcalendar.eu" style="color:#136dec;text-decoration:underline;word-break:break-all;">info@bandcalendar.eu</a></p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      ${fallbackLink}
    </td></tr>
  </table>
</body>
</html>`;
}

export type MailKind = "warning" | "final" | "deleted";
export function renderInactivityEmail(
  kind: MailKind,
  language: string,
  at: string,
  appUrl: string,
  activitySource: "observed" | "legacy_sign_in" = "observed",
) {
  const url = new URL(appUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Invalid WEB_APP_URL");
  }
  const it = language !== "en";
  const date = new Intl.DateTimeFormat(it ? "it-IT" : "en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(new Date(at)) + (it ? " (ora italiana)" : " (Italy time)");
  const title = kind === "deleted"
    ? (it
      ? "Il tuo account è stato eliminato"
      : "Your account has been deleted")
    : kind === "final"
    ? (it
      ? "Ultimo promemoria per il tuo account"
      : "Final reminder about your account")
    : activitySource === "legacy_sign_in"
    ? (it
      ? "Vuoi mantenere il tuo account?"
      : "Would you like to keep your account?")
    : (it ? "Il tuo account è inattivo" : "Your account is inactive");
  const subject = kind === "deleted"
    ? (it
      ? "Il tuo account Band Calendar è stato eliminato"
      : "Your Band Calendar account has been deleted")
    : kind === "final"
    ? (it
      ? `Il tuo account Band Calendar verrà eliminato il ${date}`
      : `Your Band Calendar account will be deleted on ${date}`)
    : activitySource === "legacy_sign_in"
    ? (it
      ? "Mantieni il tuo account Band Calendar"
      : "Keep your Band Calendar account")
    : (it
      ? "Il tuo account Band Calendar è inattivo"
      : "Your Band Calendar account is inactive");
  const text = kind === "deleted"
    ? (it
      ? `Il tuo account è stato eliminato per inattività il ${date}. Puoi registrarti nuovamente, ma la nuova registrazione non ripristinerà l’account e i dati precedenti.`
      : `Your account was deleted due to inactivity on ${date}. You can register again, but a new registration will not restore your previous account or data.`)
    : (it
      ? `${
        kind === "warning"
          ? (activitySource === "legacy_sign_in"
            ? "L’ultimo accesso registrato al tuo account risale a oltre 12 mesi fa. Ti chiediamo di aprire il calendario per confermare che desideri mantenere l’account."
            : "Non rileviamo utilizzi del tuo account da almeno 12 mesi.")
          : "Non abbiamo ancora rilevato un nuovo utilizzo del tuo account."
      } La cancellazione è prevista per il ${date}. Per mantenere l’account, apri Band Calendar e carica il calendario entro questa data. Se sei già autenticato, non devi effettuare nuovamente il login.`
      : `${
        kind === "warning"
          ? (activitySource === "legacy_sign_in"
            ? "Your last recorded sign-in was over 12 months ago. Please open the calendar to confirm that you want to keep your account."
            : "We have not detected any use of your account for at least 12 months.")
          : "We have not detected any new use of your account yet."
      } Deletion is scheduled for ${date}. To keep your account, open Band Calendar and load the calendar before this date. If you are already signed in, you do not need to sign in again.`);
  const shared = it
    ? "Il profilo personale e gli accessi ai gruppi vengono rimossi con l’account. Le attività nei calendari condivisi vengono conservate e riassegnate al proprietario del progetto."
    : "Your personal profile and group access are removed with your account. Shared calendar entries are kept and reassigned to the project owner.";
  const notice = kind === "deleted"
    ? shared
    : (it
      ? `Aprire questa email o fare clic sul link non è sufficiente: occorre usare l’app con il proprio account. ${shared}`
      : `Opening this email or clicking the link is not enough: you need to use the app with your account. ${shared}`);
  const action = kind === "deleted"
    ? undefined
    : { url: appUrl, label: it ? "Apri Band Calendar" : "Open Band Calendar" };
  return {
    subject,
    htmlContent: inactivityEmailHtml({
      title,
      text,
      language,
      notice,
      action,
      address: {
        label: kind === "deleted"
          ? (it ? "ELIMINAZIONE COMPLETATA" : "DELETION COMPLETED")
          : (it ? "DATA DI CANCELLAZIONE" : "DELETION DATE"),
        value: date,
      },
    }),
    textContent: [
      title,
      text,
      notice,
      action ? `${action.label}: ${appUrl}` : "",
      it
        ? "Buona musica,\nIl team di Band Calendar"
        : "Keep making music,\nThe Band Calendar team",
      "info@bandcalendar.eu",
    ].filter(Boolean).join("\n\n"),
  };
}
