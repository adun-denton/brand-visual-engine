import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  chmodSync,
  lstatSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createRemoteJWKSet, jwtVerify, customFetch } from "jose";
import { digest } from "../kernel/packets.ts";
import { InputError, record, string, integer } from "./validation.ts";
export interface ChatPolicy {
  version: 1;
  eligibleLocalUseReview: string;
  licenseReview: string;
  model: string;
  maxTurns: number;
  noPaid: true;
  allowLogin: true;
  toolBoundaryReview: string;
}
interface Credentials {
  client_id: string;
  subject: string;
  id_token: string;
  access_token: string;
  refresh_token: string;
  scope: string;
  expiresAt: number;
}
export class ChatAuth {
  private dir: string;
  private pending: {
    state: string;
    nonce: string;
    verifier: string;
    redirect: string;
    client: string;
    at: number;
  } | null = null;
  private host: string;
  fetcher: typeof fetch;
  private credentials: Credentials | null;
  constructor(root: string, fetcher: typeof fetch = fetch) {
    this.dir = join(root, "chat-account-private");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
    this.fetcher = fetcher;
    this.host = existsSync(join(this.dir, "host.json"))
      ? JSON.parse(readFileSync(join(this.dir, "host.json"), "utf8")).id
      : "urn:uuid:" + randomUUID();
    this.write("host.json", { id: this.host });
    this.credentials = existsSync(join(this.dir, "credentials.json"))
      ? this.readPrivate("credentials.json")
      : null;
  }
  private readPrivate(name: string) {
    const p = join(this.dir, name),
      s = lstatSync(p);
    if (
      s.isSymbolicLink() ||
      !s.isFile() ||
      (process.platform !== "win32" && s.mode & 0o077)
    )
      throw new InputError("Account storage must be protected");
    return JSON.parse(readFileSync(p, "utf8"));
  }
  private write(name: string, data: unknown) {
    const p = join(this.dir, name),
      tmp = p + ".tmp";
    writeFileSync(tmp, JSON.stringify(data) + "\n", { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, p);
  }
  policy(): ChatPolicy {
    if (process.platform === "win32")
      throw new InputError(
        "Account trial unavailable until private Windows ACL protection is reviewed",
      );
    const path = process.env["BVE_CHAT_POLICY_FILE"];
    if (!path || !isAbsolute(path))
      throw new InputError(
        "Connection awaits coordinator account/eligibility and bounded-turn review",
      );
    const p = lstatSync(path);
    if (!p.isFile() || p.isSymbolicLink() || p.mode & 0o077)
      throw new InputError("Use a protected coordinator policy outside Git");
    const v = record(JSON.parse(readFileSync(path, "utf8")), [
      "version",
      "eligibleLocalUseReview",
      "licenseReview",
      "model",
      "maxTurns",
      "noPaid",
      "allowLogin",
      "toolBoundaryReview",
    ]);
    if (v["version"] !== 1 || v["noPaid"] !== true || v["allowLogin"] !== true)
      throw new InputError(
        "Account policy does not authorize the supported bounded route",
      );
    return {
      version: 1,
      noPaid: true,
      allowLogin: true,
      eligibleLocalUseReview: string(v["eligibleLocalUseReview"]),
      licenseReview: string(v["licenseReview"]),
      model: string(v["model"], 200),
      maxTurns: integer(v["maxTurns"], 100),
      toolBoundaryReview: string(v["toolBoundaryReview"]),
    };
  }
  status() {
    return {
      connected: !!this.credentials,
      route: "ChatGPT plan · own OAuth credentials",
      liveVerified: false,
    };
  }
  begin(origin: string) {
    this.policy();
    if (this.pending && Date.now() - this.pending.at < 300000)
      throw new InputError("A sign-in is already pending");
    const state = randomBytes(32).toString("base64url"),
      nonce = randomBytes(32).toString("base64url"),
      verifier = randomBytes(48).toString("base64url"),
      redirect = origin + "/auth/callback";
    const client = this.credentials?.client_id ?? "dynamic_agent_client";
    this.pending = { state, nonce, verifier, redirect, client, at: Date.now() };
    const u = new URL("https://auth.openai.com/api/accounts/authorize");
    for (const [k, v] of Object.entries({
      client_id: client,
      ext_agent_host_id: this.host,
      response_type: "code",
      redirect_uri: redirect,
      scope:
        "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource: "https://api.openai.com/v1",
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      ...(client === "dynamic_agent_client"
        ? { agent_name_hint: "brand_visual_engine" }
        : { id_token_hint: this.credentials!.id_token }),
    }))
      u.searchParams.set(k, v);
    return { url: u.toString() };
  }
  async callback(query: URLSearchParams) {
    const p = this.pending;
    if (!p || Date.now() - p.at > 300000 || query.get("state") !== p.state)
      throw new InputError("Sign-in state is invalid or expired");
    this.pending = null;
    if (query.has("error"))
      throw new InputError(
        "ChatGPT sign-in was declined; saved drafts retained",
      );
    const client = query.get("client_id") ?? p.client;
    if (
      client === "dynamic_agent_client" ||
      (p.client !== "dynamic_agent_client" && client !== p.client)
    )
      throw new InputError("Registration identity mismatch");
    const code = string(query.get("code"), 4000);
    const r = await this.fetcher(
      "https://auth.openai.com/api/accounts/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client,
          code,
          code_verifier: p.verifier,
          redirect_uri: p.redirect,
          resource: "https://api.openai.com/v1",
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok)
      throw new InputError("Sign-in exchange failed. Begin a fresh sign-in.");
    const v = (await r.json()) as Record<string, unknown>;
    const token = string(v["id_token"], 20000);
    const verified = await jwtVerify(
      token,
      createRemoteJWKSet(
        new URL("https://auth.openai.com/.well-known/jwks.json"),
        { [customFetch]: this.fetcher },
      ),
      {
        issuer: "https://auth.openai.com",
        audience: client,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "exp", "iat"],
      },
    );
    if (
      verified.payload.nonce !== p.nonce ||
      !verified.payload.sub ||
      (this.credentials && verified.payload.sub !== this.credentials.subject)
    )
      throw new InputError("Account/nonce validation failed");
    const scope = string(v["scope"]);
    if (!scope.split(" ").includes("chatgpt.tokens.use.direct"))
      throw new InputError("ChatGPT plan permission was not granted");
    this.credentials = {
      client_id: client,
      subject: verified.payload.sub,
      id_token: token,
      access_token: string(v["access_token"], 20000),
      refresh_token: string(v["refresh_token"], 20000),
      scope,
      expiresAt: Date.now() + integer(v["expires_in"], 86400) * 1000,
    };
    this.write("credentials.json", this.credentials);
    return { connected: true };
  }
  consumeTurn() {
    const p = this.policy(),
      path = join(this.dir, "turn-budget.json");
    const saved = existsSync(path) ? this.readPrivate("turn-budget.json") : {};
    const key = digest(p);
    const used = Number(saved[key] ?? 0);
    if (used >= p.maxTurns)
      throw new InputError("The bounded account turn limit is exhausted");
    saved[key] = used + 1;
    this.write("turn-budget.json", saved);
  }
  async token() {
    this.policy();
    const c = this.credentials;
    if (!c) throw new InputError("Continue with ChatGPT to connect");
    if (Date.now() < c.expiresAt - 60000) return c.access_token;
    const r = await this.fetcher(
      "https://auth.openai.com/api/accounts/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: c.client_id,
          refresh_token: c.refresh_token,
          resource: "https://api.openai.com/v1",
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok)
      throw new InputError("ChatGPT authorization expired; sign in again");
    const v = (await r.json()) as Record<string, unknown>;
    const scope = string(v["scope"]);
    if (!scope.split(" ").includes("chatgpt.tokens.use.direct"))
      throw new InputError("ChatGPT plan permission is unavailable");
    const next = {
      ...c,
      access_token: string(v["access_token"], 20000),
      refresh_token: string(v["refresh_token"], 20000),
      scope,
      expiresAt: Date.now() + integer(v["expires_in"], 86400) * 1000,
    };
    this.write("credentials.json", next);
    this.credentials = next;
    return next.access_token;
  }
}
