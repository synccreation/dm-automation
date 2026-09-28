import { beforeEach, describe, expect, it } from "vitest";
import { countClicks, getLinkByCode } from "../src/db/links";
import { app } from "../src/index";
import { createTrackedLink, trackedUrl } from "../src/links";
import { escapeHtml } from "../src/pages";
import { resetDb, testEnv } from "./helpers";

beforeEach(resetDb);

describe("tracked links", () => {
  it("rejects non-http targets", async () => {
    await expect(createTrackedLink(testEnv.DB, "javascript:alert(1)", null, 1)).rejects.toThrow("http");
  });

  it("builds tracked URLs with an optional contact", () => {
    expect(trackedUrl("https://dm.test", "abc", "123")).toBe("https://dm.test/l/abc?c=123");
    expect(trackedUrl("https://dm.test", "abc")).toBe("https://dm.test/l/abc");
  });

  it("redirects and records the click with the contact", async () => {
    const link = await createTrackedLink(testEnv.DB, "https://example.com/guide", "Guide", 1);
    expect(link.code).toMatch(/^[A-Za-z0-9]{8}$/);
    const res = await app.request(`/l/${link.code}?c=17841`, { redirect: "manual" }, testEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://example.com/guide");
    expect(await countClicks(testEnv.DB, link.id)).toBe(1);
    const row = await testEnv.DB.prepare("SELECT contact_igsid FROM clicks").first<{ contact_igsid: string | null }>();
    expect(row?.contact_igsid).toBe("17841");
  });

  it("ignores a contact parameter that is not an Instagram id", async () => {
    const link = await createTrackedLink(testEnv.DB, "https://example.com", null, 1);
    await app.request(`/l/${link.code}?c=<script>`, { redirect: "manual" }, testEnv);
    const row = await testEnv.DB.prepare("SELECT contact_igsid FROM clicks").first<{ contact_igsid: string | null }>();
    expect(row?.contact_igsid).toBeNull();
  });

  it("returns 404 for unknown codes", async () => {
    const res = await app.request("/l/missing1", { redirect: "manual" }, testEnv);
    expect(res.status).toBe(404);
    expect(await getLinkByCode(testEnv.DB, "missing1")).toBeNull();
  });
});

describe("legal pages", () => {
  it.each(["/privacy", "/terms", "/data-deletion"])("%s shows the contact email", async (path) => {
    const res = await app.request(path, {}, testEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain("creator@example.com");
  });

  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
