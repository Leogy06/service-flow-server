import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import process from "node:process";

if (process.env.NODE_ENV !== "test") throw new Error("The audit preload requires explicit NODE_ENV=test");

const frontend = new URL("../../../frontend/", import.meta.url);

// Used only by the explicitly isolated audit runner. Never load operator env
// files or send real mail while exercising synthetic database fixtures.
registerHooks({ resolve(specifier, context, nextResolve) {
  // These are business/SQL suites, not quota-policy suites. Never raise a
  // production limit to accommodate many synthetic mutations in one second.
  if (process.env.SERVICEFLOW_AUDIT_BUSINESS_TEST === "1" && /(?:^|\/)middleware\/rateLimiter(?:\.ts|\.js)?$/.test(specifier)) {
    const names = ["authLimiter", "signupLimiter", "refreshLimiter", "feedbackLimiter", "publicApiLimiter", "publicWriteLimiter", "apiLimiter", "strictLimiter", "writeLimiter", "writeLimmiter", "deleteLimiter", "refundLimiter", "brandingUploadLimiter", "brandingAssetLimiter", "publicPageLimiter"];
    const code = `const pass=(_req,_res,next)=>next(); ${names.map(name => `export const ${name}=pass;`).join(" ")} export const unauthenticatedErrorLimiter=(error,_req,_res,next)=>next(error);`;
    return { url: "data:text/javascript," + encodeURIComponent(code), shortCircuit: true };
  }
  if (specifier === "dotenv") return { url: "data:text/javascript,export const config=()=>({}); export const parse=()=>{throw Error('Private environment parsing disabled in isolated audit');};", shortCircuit: true };
  if (specifier === "resend") return { url: "data:text/javascript,export class Resend { emails={send:async()=>({error:{message:'Inert audit email provider'}})}; }", shortCircuit: true };
  // Cross-layer Node tests import both repositories. Resolve a frontend alias
  // against its own source root rather than the backend tsconfig's @/src path.
  if (specifier.startsWith("@/") && context.parentURL?.startsWith(frontend.href)) {
    for (const suffix of ["", ".ts", ".tsx", ".js", "/index.ts"]) {
      const target = new URL(specifier.slice(2) + suffix, frontend);
      if (target.href.startsWith(frontend.href) && existsSync(target)) return { url: target.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
} });
