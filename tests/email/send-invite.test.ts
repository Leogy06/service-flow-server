import { jest } from "@jest/globals";
import { createHash } from "node:crypto";

const env = {
  CORS_ORIGIN: "https://app.example.com",
  RESEND_API_KEY: "re_test_fixture",
  EMAIL_FROM: "ServiceFlow <test@example.com>",
};
jest.unstable_mockModule("@/config/env", () => ({ env }));
const { sendInviteEmail } = await import("../../src/lib/email/send-invite");

interface EmailPayload {
  from: string;
  to: string;
  html: string;
  attachments?: {
    filename: string;
    content: string;
    content_type: string;
    content_id: string;
    path?: string;
  }[];
}

const invite = { to: "alex+staff@example.com", firstName: "Alex", token: "sample-private-token" };
const fetchSpy = jest.spyOn(globalThis, "fetch");
const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  env.CORS_ORIGIN = "https://app.example.com";
  fetchSpy.mockReset().mockResolvedValue(Response.json({ id: "email-fixture" }));
  consoleErrorSpy.mockClear();
});

afterAll(() => {
  fetchSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

it.each(["https://app.example.com", "http://localhost:4001"])(
  "sends the brand PNG inside the email when the application origin is %s",
  async (origin) => {
    env.CORS_ORIGIN = origin;
    await expect(sendInviteEmail(invite)).resolves.toEqual({ id: "email-fixture" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as EmailPayload;
    expect(payload.from).toBe("ServiceFlow <test@example.com>");
    expect(payload.to).toBe(invite.to);
    expect(payload.html).toContain(
      `href="${origin}/set-password?token=sample-private-token&amp;email=alex%2Bstaff%40example.com"`,
    );
    expect(payload.attachments).toHaveLength(1);
    const attachment = payload.attachments![0]!;
    expect(attachment.content_type).toBe("image/png");
    expect(attachment.filename).toMatch(/\.png$/);
    expect(attachment.path).toBeUndefined();
    expect(payload.html).toContain(`src="cid:${attachment.content_id}"`);
    expect(attachment.content_id).not.toContain(invite.token);
    expect(attachment.content_id).not.toContain(invite.to);

    const png = Buffer.from(attachment.content, "base64");
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(96);
    expect(png.readUInt32BE(20)).toBe(96);
    // Approved Handoff email-mark.png; keep this test independent of the frontend checkout.
    expect(createHash("sha256").update(png).digest("hex"))
      .toBe("db2a3edceb86b33a3a418b6c192dd18cb1114ea445fe646a6d56e5fa301322a7");
  },
);

it("rejects provider failures without exposing provider details or logging invitation data", async () => {
  const error = { name: "validation_error", message: "Sample delivery rejected", statusCode: 422 };
  fetchSpy.mockResolvedValue(Response.json(error, { status: 422 }));
  await expect(sendInviteEmail(invite)).rejects.toThrow("Invitation delivery failed");
  expect(consoleErrorSpy).not.toHaveBeenCalled();
});

it("propagates network failure", async () => {
  fetchSpy.mockRejectedValue(new Error("Sample network failure"));
  await expect(sendInviteEmail(invite)).rejects.toThrow("Invitation delivery failed");
  expect(consoleErrorSpy).not.toHaveBeenCalled();
});
