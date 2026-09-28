import { getLinkByCode, insertClick, insertLink, type LinkRow } from "./db/links";

// No look-alike characters (0/O, 1/l/I), so codes are easy to read aloud if ever needed.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function randomCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export async function createTrackedLink(
  db: D1Database, targetUrl: string, label: string | null, now: number,
): Promise<LinkRow> {
  if (!isHttpUrl(targetUrl)) throw new Error("Link must be an http(s) URL");
  return insertLink(db, randomCode(), targetUrl, label, now);
}

export function trackedUrl(publicUrl: string, code: string, contactIgsid?: string | null): string {
  const url = new URL(`/l/${code}`, publicUrl);
  if (contactIgsid) url.searchParams.set("c", contactIgsid);
  return url.toString();
}

export async function handleLinkRedirect(
  db: D1Database, code: string, contactParam: string | null, now: number,
): Promise<Response> {
  const link = await getLinkByCode(db, code);
  if (!link) return new Response("Link not found", { status: 404 });
  const contact = contactParam && /^\d{1,32}$/.test(contactParam) ? contactParam : null;
  await insertClick(db, link.id, contact, now);
  return Response.redirect(link.target_url, 302);
}
