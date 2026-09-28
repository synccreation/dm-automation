const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

export function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.6}</style>
</head>
<body><h1>${escapeHtml(title)}</h1>${bodyHtml}</body>
</html>`;
}

export function privacyPage(email: string): string {
  const mail = escapeHtml(email);
  return page("Privacy Policy", `
<p>This service automates replies to Instagram comments and direct messages on behalf of the account owner.</p>
<p>When you comment on or message the account, we store your Instagram username, your Instagram-scoped user ID,
the messages you exchange with the account, and whether you opened links we sent you. We use this only to reply
to you and to measure how many people open those links. We do not sell or share this data.</p>
<p>Messages are sent and received through Zernio (Zernio Software SL), our Instagram messaging provider,
and stored with Cloudflare. To have your data deleted, see <a href="/data-deletion">data deletion</a>
or email <a href="mailto:${mail}">${mail}</a>.</p>`);
}

export function termsPage(email: string): string {
  const mail = escapeHtml(email);
  return page("Terms of Service", `
<p>Automated messages from this account are provided as-is, for information about the account owner's content,
products and services. Do not send sensitive personal information by direct message.</p>
<p>Questions: <a href="mailto:${mail}">${mail}</a>.</p>`);
}

export function dataDeletionPage(email: string): string {
  const mail = escapeHtml(email);
  return page("Data Deletion", `
<p>To delete the data this service holds about you, email <a href="mailto:${mail}">${mail}</a> with your
Instagram username. We delete your username, ID, messages and link-click records within 30 days and confirm by email.</p>`);
}
