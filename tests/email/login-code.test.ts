import { jest } from "@jest/globals";

const env = {
  RESEND_API_KEY: "re_test_fixture",
  EMAIL_FROM: "ServiceFlow <test@example.com>",
};
jest.unstable_mockModule("@/config/env", () => ({ env }));
const { sendLoginCodeEmail } = await import("../../src/lib/email/send-login-code");
const { loginCodeHtml } = await import("../../src/lib/email/templates/login-code");

interface EmailPayload {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: { content_type: string; content_id: string }[];
}

const fetchSpy = jest.spyOn(globalThis, "fetch");
const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  fetchSpy.mockReset().mockResolvedValue(Response.json({ id: "email-fixture" }));
  consoleErrorSpy.mockClear();
});

afterAll(() => {
  fetchSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

it("sends a tenant sign-in code with the shared inline logo and expiry in both formats", async () => {
  await expect(sendLoginCodeEmail("alex@example.com", "Alex", "012345", "tenant", "Bright Star"))
    .resolves.toBeUndefined();

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as EmailPayload;
  expect(payload.from).toBe("ServiceFlow <test@example.com>");
  expect(payload.to).toBe("alex@example.com");
  expect(payload.subject).not.toContain("012345");
  expect(payload.html).toContain("012345");
  expect(payload.html).toContain("Bright Star");
  expect(payload.html).toContain("10 minutes");
  expect(payload.text).toContain("012345");
  expect(payload.text).toContain("10 minutes");
  expect(payload.attachments).toHaveLength(1);
  expect(payload.attachments[0]?.content_type).toBe("image/png");
  expect(payload.html).toContain(`src="cid:${payload.attachments[0]?.content_id}"`);
  expect(payload.html).toContain(">ServiceFlow</td>");
  expect(payload.html).not.toMatch(/<img src="https?:/);
  expect(payload.html).not.toContain("<a href=");
});

it("identifies the system-admin surface and uses the supplied expiry without tenant branding", async () => {
  await sendLoginCodeEmail("admin@example.com", "Platform", "654321", "system-admin", "Ignored tenant", 3);

  const payload = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as EmailPayload;
  expect(payload.subject).toContain("administration");
  expect(payload.html).toContain("ServiceFlow administration");
  expect(payload.html).toContain("3 minutes");
  expect(payload.html).not.toContain("Ignored tenant");
  expect(payload.text).toContain("ServiceFlow administration");
  expect(payload.text).toContain("3 minutes");
});

it("escapes names, tenant names and the supplied code in the shared HTML layout", () => {
  const html = loginCodeHtml({
    firstName: '<img src=x onerror="bad()">',
    code: "<script>bad()</script>",
    surface: "tenant",
    organizationName: '<b>Bright & Star</b>',
    expiresInMinutes: 10,
  });
  expect(html).toContain("Hi &lt;img src=x onerror=&quot;bad()&quot;&gt;,");
  expect(html).toContain("&lt;b&gt;Bright &amp; Star&lt;/b&gt;");
  expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
  expect(html.match(/<img /g)).toHaveLength(1);
  expect(html).not.toContain("<script>");
});

it("uses a generic workspace description when a tenant name is unavailable", () => {
  const html = loginCodeHtml({ firstName: "", code: "012345", surface: "tenant", expiresInMinutes: 1 });
  expect(html).toContain("Hi there,");
  expect(html).toContain("your ServiceFlow workspace");
  expect(html).toContain("1 minute.");
  expect(html).not.toContain("undefined");
  expect(html).not.toContain("null");
});

it("replaces provider rejection details with a safe delivery error without logging the code", async () => {
  fetchSpy.mockResolvedValue(Response.json({
    name: "validation_error", message: "Rejected code 012345 for alex@example.com", statusCode: 422,
  }, { status: 422 }));

  await expect(sendLoginCodeEmail("alex@example.com", "Alex", "012345", "tenant"))
    .rejects.toThrow("Unable to send verification email");
  expect(consoleErrorSpy).not.toHaveBeenCalled();
});

it("returns the same safe delivery error on a network failure", async () => {
  fetchSpy.mockRejectedValue(new Error("Network payload contained 012345"));
  await expect(sendLoginCodeEmail("alex@example.com", "Alex", "012345", "tenant"))
    .rejects.toThrow("Unable to send verification email");
  expect(consoleErrorSpy).not.toHaveBeenCalled();
});

it("rejects a malformed successful provider response instead of claiming the code was sent", async () => {
  fetchSpy.mockResolvedValue(Response.json({ message: "Missing delivery identifier" }));
  await expect(sendLoginCodeEmail("alex@example.com", "Alex", "012345", "tenant"))
    .rejects.toThrow("Unable to send verification email");
});
