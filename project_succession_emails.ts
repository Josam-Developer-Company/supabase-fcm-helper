// Publish beside inactive_account_emails.ts in the shared helper repository.
import { inactivityEmailHtml } from "./inactive_account_emails.ts";

export type SuccessionMail = {
  id: string;
  lease: string;
  email: string;
  lang: string;
  kind: "invitation" | "transferred" | "archived" | "reactivated";
  offer_id?: string;
  project_id: string;
  project_name: string;
  owner_name?: string;
  phase?: string;
  deadline?: string;
};
const date = (value: string, it: boolean) =>
  new Intl.DateTimeFormat(it ? "it-IT" : "en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(new Date(value)) + (it ? " (ora italiana)" : " (Italy time)");

export function successionLink(
  appUrl: string,
  path: string,
  query: Record<string, string> = {},
) {
  const url = new URL(appUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Invalid WEB_APP_URL");
  }
  // Use the existing verified Android App Links / browser fallback gateway.
  if (
    path === "/project-succession" && !url.pathname.endsWith("/email-link/")
  ) {
    url.pathname = url.pathname.replace(/\/?$/, "/") + "email-link/";
  }
  url.search = "";
  url.hash = `${path}${
    Object.keys(query).length ? "?" + new URLSearchParams(query) : ""
  }`;
  return url.toString();
}

export function renderSuccessionEmail(job: SuccessionMail, appUrl: string) {
  const it = job.lang !== "en";
  const invitation = job.kind === "invitation";
  if (invitation && (!job.offer_id || !/^[0-9a-f-]{36}$/i.test(job.offer_id))) {
    throw new Error("Missing proposal");
  }
  const archived = job.kind === "archived";
  const isAdmin = job.phase === "admins";
  const project = job.project_name;
  const title = invitation
    ? (it
      ? (isAdmin
        ? "Dai continuità alla tua musica"
        : "Puoi mantenere attivo il progetto")
      : "Keep your project going")
    : archived
    ? (it
      ? "Il progetto resta consultabile"
      : "Your project is still available to view")
    : job.kind === "reactivated"
    ? (it ? "Il progetto è di nuovo attivo" : "Your project is active again")
    : (it ? "La musica continua" : "The music continues");
  const subject = invitation
    ? (it
      ? `${project}: vuoi diventare il nuovo proprietario?`
      : `${project}: would you like to become the owner?`)
    : archived
    ? (it ? `${project} è stato archiviato` : `${project} has been archived`)
    : (it
      ? `${project} ha un nuovo proprietario`
      : `${project} has a new owner`);
  const text = invitation
    ? (it
      ? `Il proprietario di ${project} non ha ripreso l’attività dopo i preavvisi. ${
        isAdmin ? "Come amministratore" : "Come membro idoneo"
      } puoi scegliere di diventare il nuovo proprietario. Potrai gestire il progetto, i gruppi e i membri. Rispondi entro il ${
        date(job.deadline!, it)
      }.`
      : `The owner of ${project} has not returned after the inactivity notices. As ${
        isAdmin ? "an administrator" : "an eligible member"
      }, you can choose to become the new owner and manage the project, groups and members. Reply by ${
        date(job.deadline!, it)
      }.`)
    : archived
    ? (it
      ? `Nessun membro ha accettato la proprietà di ${project} entro la scadenza. Il progetto è stato archiviato: puoi consultare gli eventi che eri autorizzato a vedere, ma non modificarli. I membri idonei possono assumere la proprietà e riattivarlo dall’app.`
      : `No member accepted ownership of ${project} before the deadline. The project has been archived: you can view events you were already allowed to see, but cannot change them. Eligible members can take ownership and reactivate it in the app.`)
    : (it
      ? `${
        job.owner_name || "Un membro del progetto"
      } ha assunto la proprietà di ${project}. Il progetto è attivo. Il trasferimento non modifica automaticamente gli altri ruoli o la visibilità degli eventi.`
      : `${
        job.owner_name || "A project member"
      } has taken ownership of ${project}. The project is active. Other roles and event visibility have not been changed automatically.`);
  const notice = invitation
    ? (it
      ? `Apri l’app e accedi con l’account che utilizzi per questo progetto. Il clic nell’email non trasferisce la proprietà: serve una conferma esplicita. ${
        isAdmin
          ? "Se nessun amministratore accetta, la proposta sarà estesa agli altri membri idonei."
          : "Se nessuno accetta, il progetto verrà archiviato e resterà in sola consultazione."
      }`
      : `Sign in with the account you use for this project. Clicking the email does not transfer ownership: you must explicitly confirm in the app. ${
        isAdmin
          ? "If no administrator accepts, other eligible members will be invited."
          : "If nobody accepts, the project will be archived and become read-only."
      }`)
    : (it
      ? "L’accesso ai dati resta limitato ai membri autorizzati. La proprietà non viene mai assegnata senza accettazione."
      : "Access remains limited to authorized members. Ownership is never assigned without acceptance.");
  const action = {
    url: invitation
      ? successionLink(appUrl, "/project-succession", { offer: job.offer_id! })
      : successionLink(appUrl, "/project-succession", {
        project: job.project_id,
      }),
    label: invitation
      ? (it ? "Valuta la proposta" : "Review the proposal")
      : archived
      ? (it ? "Consulta il progetto" : "View the project")
      : (it ? "Apri il progetto" : "Open the project"),
  };
  const htmlContent = inactivityEmailHtml({
    title,
    text,
    language: job.lang,
    action,
    notice,
    address: {
      label: invitation
        ? (it
          ? "PROGETTO · SCADENZA DELLA PROPOSTA"
          : "PROJECT · PROPOSAL DEADLINE")
        : (it ? "PROGETTO" : "PROJECT"),
      value: project + (invitation ? " · " + date(job.deadline!, it) : ""),
    },
  });
  return {
    subject,
    htmlContent: htmlContent.replace(
      it ? "SICUREZZA DEL TUO ACCOUNT" : "YOUR ACCOUNT SECURITY",
      it ? "IL FUTURO DEL TUO PROGETTO" : "YOUR PROJECT’S FUTURE",
    ),
    textContent: [
      title,
      text,
      action.label + ": " + action.url,
      notice,
      it
        ? "Buona musica,\nIl team di Band Calendar"
        : "Keep making music,\nThe Band Calendar team",
    ].join("\n\n"),
  };
}

export function renderOwnerInactivityEmail(job: {
  kind: string;
  lang: string;
  deadline: string;
  deleted_at?: string;
  project_outcomes?: { name: string; state: string }[];
}, appUrl: string) {
  const it = job.lang !== "en";
  const deleted = job.kind === "deleted";
  const final = job.kind === "final";
  const title = deleted
    ? (it
      ? "Il tuo account è stato eliminato"
      : "Your account has been deleted")
    : final
    ? (it ? "C’è ancora tempo per tornare" : "There is still time to return")
    : (it ? "Il tuo account è inattivo" : "Your account is inactive");
  const text = deleted
    ? (it
      ? `La procedura per inattività è terminata. Il tuo account è stato eliminato il ${
        date(job.deleted_at!, it)
      } dopo la gestione dei progetti che possedevi.`
      : `Your account was deleted for inactivity on ${
        date(job.deleted_at!, it)
      }, after your owned projects had been handled.`)
    : (it
      ? `Non rileviamo un nuovo utilizzo del tuo account. Per mantenerlo, apri Band Calendar e carica il calendario entro il ${
        date(job.deadline, it)
      }. Dopo questa data cercheremo un nuovo proprietario per i tuoi progetti tra i membri idonei. Se nessuno accetta, i progetti verranno archiviati. Il tuo account potrà essere eliminato solo dopo la conclusione della procedura.`
      : `We have not detected new use of your account. To keep it, open Band Calendar and load your calendar by ${
        date(job.deadline, it)
      }. After that date, eligible members will be invited to take ownership of your projects. If nobody accepts, projects will be archived. Your account can only be deleted once that process is complete.`);
  const outcomes = (job.project_outcomes ?? []).map((p) =>
    `${p.name}: ${
      p.state === "transferred"
        ? (it ? "trasferito" : "transferred")
        : p.state === "archived"
        ? (it ? "archiviato" : "archived")
        : (it ? "gestione conclusa" : "completed")
    }`
  ).join(" · ");
  const notice = deleted
    ? (it
      ? "Una nuova registrazione non ripristina automaticamente l’account, le appartenenze o la proprietà dei progetti. Gli eventi condivisi conservati restano soggetti ai permessi del progetto; note private e dati personali non vengono copiati nell’archivio."
      : "Registering again does not automatically restore your old account, memberships or project ownership. Preserved shared events retain project access rules; private notes and personal data are not copied into the archive.")
    : (it
      ? "Aprire questa email o fare clic sul link non è sufficiente: occorre usare l’app con il proprio account. Tornare attivo annulla i passaggi non ancora completati; una proprietà già accettata da un altro membro non viene revocata automaticamente."
      : "Opening this email or clicking its link is not enough: use the app with your account. Returning cancels steps that have not completed; ownership already accepted by another member is not automatically reversed.");
  const action = deleted ? undefined : {
    url: successionLink(appUrl, "/project-succession", { account: "true" }),
    label: it ? "Apri Band Calendar" : "Open Band Calendar",
  };
  return {
    subject: it ? `Band Calendar · ${title}` : `Band Calendar · ${title}`,
    htmlContent: inactivityEmailHtml({
      title,
      text,
      notice,
      language: job.lang,
      action,
      address: {
        label: deleted
          ? (it ? "ESITO DEI TUOI PROGETTI" : "YOUR PROJECTS")
          : (it ? "TERMINE PER MANTENERE L’ACCOUNT" : "RETURN BY"),
        value: deleted
          ? outcomes ||
            (it
              ? "Gestione dei progetti completata"
              : "Project handling completed")
          : date(job.deadline, it),
      },
    }),
    textContent: [title, text, outcomes, action?.url ?? "", notice].filter(
      Boolean,
    ).join("\n\n"),
  };
}
