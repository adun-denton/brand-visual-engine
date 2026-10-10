import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { ChatAuth } from "../src/service/chat-auth.ts";
import type { ChatPolicy } from "../src/service/chat-auth.ts";
const policy: ChatPolicy = {
  version: 1,
  eligibleLocalUseReview: "Synthetic offline review fixture",
  licenseReview: "No license decision; offline only",
  model: "gpt-6-luna",
  maxTurns: 2,
  noPaid: true,
  allowLogin: true,
  toolBoundaryReview: "Synthetic offline receipt",
};
class FixtureAuth extends ChatAuth {
  override policy() {
    return policy;
  }
}
const root = () => mkdtempSync(join(tmpdir(), "bve-chat-auth-"));
test("OAuth state, declined permission and incomplete/client-mismatched callbacks fail before token exchange", async () => {
  let exchanges = 0;
  const auth = new FixtureAuth(root(), async () => {
    exchanges++;
    throw Error("Must not exchange");
  });
  const u = new URL(auth.begin("http://127.0.0.1:4987").url);
  assert.equal(u.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.ok(u.searchParams.get("nonce"));
  assert.ok(u.searchParams.get("scope")!.includes("chatgpt.tokens.use.direct"));
  await assert.rejects(
    auth.callback(new URLSearchParams({ state: "wrong", code: "synthetic" })),
  );
  await assert.rejects(
    auth.callback(
      new URLSearchParams({
        state: u.searchParams.get("state")!,
        error: "access_denied",
      }),
    ),
  );
  const v = new URL(auth.begin("http://127.0.0.1:4987").url);
  await assert.rejects(
    auth.callback(
      new URLSearchParams({
        state: v.searchParams.get("state")!,
        code: "synthetic",
      }),
    ),
  );
  assert.equal(exchanges, 0);
  await assert.rejects(
    auth.callback(
      new URLSearchParams({
        state: v.searchParams.get("state")!,
        client_id: "oaiapp_synthetic",
        code: "synthetic",
      }),
    ),
  );
});
test("OAuth verifies signature, nonce, issuer, audience, expiry and plan permission; protects credentials and persistent budget", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "synthetic" };
  let nonce = "",
    scope = "chatgpt.tokens.use.direct offline_access",
    subject = "synthetic-account",
    issuer = "https://auth.openai.com",
    audience = "oaiapp_synthetic",
    badSignature = false,
    expired = false,
    refreshes = 0;
  const path = root();
  const transport: typeof fetch = async (url, options) => {
    if (String(url).includes("jwks.json"))
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "Content-Type": "application/json" },
      });
    const body = new URLSearchParams(String(options?.body));
    if (body.get("grant_type") === "refresh_token") {
      refreshes++;
      return new Response(
        JSON.stringify({
          access_token: "synthetic-renewed",
          refresh_token: "synthetic-rotated",
          scope,
          expires_in: 3600,
        }),
      );
    }
    let jwt = await new SignJWT({ nonce })
      .setProtectedHeader({ alg: "RS256", kid: "synthetic" })
      .setSubject(subject)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expired ? "1 second ago" : "2 minutes")
      .sign(privateKey);
    if (badSignature) jwt = jwt.slice(0, -5) + "aaaaa";
    return new Response(
      JSON.stringify({
        id_token: jwt,
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        scope,
        expires_in: 1,
      }),
    );
  };
  const auth = new FixtureAuth(path, transport);
  const callback = async (change?: () => void) => {
    const u = new URL(auth.begin("http://127.0.0.1:4987").url);
    nonce = u.searchParams.get("nonce")!;
    change?.();
    return auth.callback(
      new URLSearchParams({
        state: u.searchParams.get("state")!,
        client_id: "oaiapp_synthetic",
        code: "synthetic-code",
      }),
    );
  };
  for (const change of [
    () => {
      nonce = "wrong";
    },
    () => {
      issuer = "https://foreign.invalid";
    },
    () => {
      audience = "foreign-client";
    },
    () => {
      expired = true;
    },
    () => {
      badSignature = true;
    },
    () => {
      scope = "openid";
    },
  ]) {
    await assert.rejects(callback(change));
    issuer = "https://auth.openai.com";
    audience = "oaiapp_synthetic";
    expired = false;
    badSignature = false;
    scope = "chatgpt.tokens.use.direct offline_access";
  }
  await callback();
  assert.equal(auth.status().connected, true);
  assert.equal(await auth.token(), "synthetic-renewed");
  assert.equal(refreshes, 1);
  const stored = JSON.parse(
    readFileSync(join(path, "chat-account-private/credentials.json"), "utf8"),
  );
  assert.equal(stored.refresh_token, "synthetic-rotated");
  assert.ok(!JSON.stringify(auth.status()).includes("synthetic-access"));
  if (process.platform !== "win32")
    assert.equal(
      lstatSync(join(path, "chat-account-private/credentials.json")).mode &
        0o077,
      0,
    );
  await assert.rejects(
    callback(() => {
      subject = "another-account";
    }),
  );
  subject = "synthetic-account";
  auth.consumeTurn();
  auth.consumeTurn();
  const again = new FixtureAuth(path, transport);
  assert.throws(() => again.consumeTurn(), /limit/);
});
