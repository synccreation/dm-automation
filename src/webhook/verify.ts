export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Zernio signs the raw body: `X-Zernio-Signature: <lowercase hex HMAC-SHA256>` (no prefix). */
export async function verifyZernioSignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  return constantTimeEqual(header.trim().toLowerCase(), await hmacSha256Hex(secret, rawBody));
}
