import { inviteUserHtml } from "../../src/lib/email/templates/invite-user";
import { resetPasswordHtml } from "../../src/lib/email/templates/reset-password";

const actionUrl = "https://example.com/set-password?token=sample-token&email=alex%40example.com";
const templates = [
  { name: "invitation", render: (firstName: string, url: string) => inviteUserHtml({ firstName, inviteUrl: url }) },
  { name: "password reset", render: (firstName: string, url: string) => resetPasswordHtml({ firstName, resetUrl: url }) },
];

describe.each(templates)("$name email safety", ({ render }) => {
  it("escapes names as text instead of allowing injected HTML", () => {
    const html = render('<img src=x onerror="alert(1)"> & \'Alex\'', actionUrl);
    expect(html).toContain("Hi &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;Alex&#39;,");
    expect(html).not.toContain('<img src=x');
    expect(html.match(/<img /g)).toHaveLength(1);
  });

  it("preserves query parameters in both action links without allowing attribute injection", () => {
    const html = render("Alex", `${actionUrl}&label=" onclick="alert(1)`);
    const safeUrl = `${actionUrl.replaceAll("&", "&amp;")}&amp;label=&quot; onclick=&quot;alert(1)`;
    expect(html.match(/<a href=/g)).toHaveLength(2);
    expect(html.split(`href="${safeUrl}"`)).toHaveLength(3);
    expect(html).not.toContain('" onclick="');
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//example.com/set-password",
    "/set-password",
  ])("rejects unsafe or relative action URL %s", (url) => {
    expect(() => render("Alex", url)).toThrow();
  });

  it("accepts the local HTTP application origin", () => {
    expect(render("Alex", "http://localhost:4001/set-password?token=sample"))
      .toContain('href="http://localhost:4001/set-password?token=sample"');
  });

  it("uses the shared system mark from the application origin without private action parameters", () => {
    const html = render("Alex", actionUrl);
    const source = html.match(/<img src="([^"]+)"/)?.[1];
    expect(source).toBeDefined();
    const imageUrl = new URL(source!.replaceAll("&amp;", "&"));
    expect(imageUrl.origin).toBe("https://example.com");
    expect(imageUrl.pathname).toBe("/service-flow-logo/handoff/email-mark.png");
    expect([...imageUrl.searchParams]).toEqual([]);
    expect(source).not.toContain("token");
    expect(source).not.toContain("email=");
    expect(html).toContain('alt="" width="48" height="48"');
    expect(html).toContain(">ServiceFlow</td>");
  });

  it("uses the configured local origin for logo previews", () => {
    expect(render("Alex", "http://localhost:4001/set-password?token=sample"))
      .toContain('src="http://localhost:4001/service-flow-logo/handoff/email-mark.png"');
  });
});
