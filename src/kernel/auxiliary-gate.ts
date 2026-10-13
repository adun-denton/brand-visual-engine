import type { GateEnvironment } from "./gate.ts";
import type { NodePacket, DesignArtifact } from "./contracts.ts";
import { canonical, digest, reference } from "./packets.ts";
import {
  auxiliaryRoles,
  parseAuxiliary,
  parseScope,
  parseTurn,
  parseProposal,
  parseAction,
  parseBridge,
  auxiliaryTools,
  bridgeTools,
} from "../modules/website/auxiliary-contracts.ts";
import {
  scopeFacts,
  scopeBoundary,
  auxiliaryOwn,
} from "./auxiliary-context.ts";
import {
  same,
  parseReconstructionRequest,
} from "../modules/website/reconstruction-contracts.ts";
const eq = (a: unknown, b: unknown, msg: string) => {
  if (canonical(a) !== canonical(b)) throw Error(msg);
};
export function auxiliaryGate(
  p: NodePacket<unknown>,
  previous: NodePacket<unknown> | null,
  env: GateEnvironment,
) {
  const a = p.payload as DesignArtifact<any>,
    old = previous?.payload as DesignArtifact<any> | undefined;
  if (old && Object.hasOwn(auxiliaryRoles, old.kind) && old.kind !== a.kind)
    throw Error("Auxiliary record kind cannot change");
  if (!Object.hasOwn(auxiliaryRoles, a.kind)) return;
  if (
    p.type !== "work-record" ||
    p.approval !== "proposal" ||
    p.contextRefs.length ||
    p.assets.length ||
    a.scope !== "auxiliary" ||
    Object.keys(a.lockedValues).length
  )
    throw Error("Auxiliary work-record envelope");
  const state = parseAuxiliary(a.kind, a.state),
    stored = env.lookup(reference(p));
  if (!stored && !env.auxiliaryWriteAllowed?.(p))
    throw Error("Auxiliary write requires scoped controller authority");
  const pid = p.projectId!;
  if (
    !stored &&
    (env.projectRefs?.(pid, 4096, false) ?? []).some((r) =>
      same(r, reference(p)),
    )
  )
    throw Error("Lost auxiliary canonical version cannot be reused");
  if (a.kind === "auxiliary-scope") {
    if (previous) throw Error("Immutable auxiliary scope");
    const s = parseScope(state);
    if (
      s.contextDigest !== digest(s.context) ||
      s.boundaryDigest !== scopeBoundary(s) ||
      !same(s.workUnit, s.focus.unit) ||
      !same(s.workUnit, s.target.workUnit) ||
      s.target.projectId !== pid ||
      s.session !== s.target.session
    )
      throw Error("Auxiliary scope binding mismatch");
    if (!stored) {
      const facts = scopeFacts(env, pid, s);
      eq(s.context, facts.context, "Auxiliary context forged");
      eq(p.dependencies, facts.refs, "Auxiliary context dependency mismatch");
    }
  } else if (a.kind === "auxiliary-turn") {
    const t = parseTurn(state),
      scope = auxiliaryOwn(env, pid, t.scope, "auxiliary-scope") as NodePacket<
        DesignArtifact<any>
      >,
      s = parseScope(scope.payload.state);
    if (
      !same(t.workUnit, s.workUnit) ||
      t.contextDigest !== s.contextDigest ||
      t.tools.some(
        (c) => !(auxiliaryTools as readonly string[]).includes(c.name),
      )
    )
      throw Error("Auxiliary turn binding/tools");
    eq(
      p.dependencies,
      [t.workUnit, t.scope, ...t.proposals],
      "Auxiliary turn dependencies",
    );
    if (previous) {
      const old = parseTurn((previous.payload as DesignArtifact<any>).state);
      eq(
        {
          ...t,
          status: old.status,
          reply: old.reply,
          detail: old.detail,
          tools: old.tools,
          proposals: old.proposals,
        },
        old,
        "Frozen turn inputs changed",
      );
      if (
        (old.status !== "running" &&
          !["cancelled", "expired"].includes(old.status)) ||
        (old.status !== "running" && t.status !== "historical")
      )
        throw Error("Auxiliary terminal turn cannot resume");
    }
    for (const r of t.proposals) {
      const pp = auxiliaryOwn(env, pid, r, "auxiliary-proposal") as NodePacket<
        DesignArtifact<any>
      >;
      const proposal = parseProposal(pp.payload.state);
      if (proposal.turn.id !== p.id || !same(proposal.scope, t.scope))
        throw Error("Turn proposal binding");
    }
  } else if (a.kind === "auxiliary-proposal") {
    if (previous) throw Error("Immutable auxiliary proposal");
    const s = parseProposal(state),
      scope = auxiliaryOwn(env, pid, s.scope, "auxiliary-scope") as NodePacket<
        DesignArtifact<any>
      >,
      q = parseScope(scope.payload.state);
    if (
      s.contextDigest !== q.contextDigest ||
      !same(s.workUnit, q.workUnit) ||
      s.turn.version !== 1 ||
      s.edits.some((e) => !q.editable.includes(e.field))
    )
      throw Error("Proposal scope/edit binding");
    eq(s.target, q.target, "Proposal target forged");
    eq(s.draft, q.draft, "Proposal draft token forged");
    auxiliaryOwn(env, pid, s.turn, "auxiliary-turn");
    eq(
      p.dependencies,
      [s.workUnit, s.scope, s.turn],
      "Proposal dependency mismatch",
    );
  } else if (a.kind === "auxiliary-action") {
    if (previous) throw Error("Immutable auxiliary action");
    const s = parseAction(state),
      proposal = auxiliaryOwn(
        env,
        pid,
        s.proposal,
        "auxiliary-proposal",
      ) as NodePacket<DesignArtifact<any>>,
      q = parseProposal(proposal.payload.state);
    if (
      !same(s.workUnit, q.workUnit) ||
      s.session !== q.target.session ||
      (s.decision === "applied" &&
        (q.historical ||
          !sameToken(s.expected, q.draft) ||
          !s.result ||
          s.result.id !== s.expected.id ||
          s.result.revision !== s.expected.revision + 1))
    )
      throw Error("Auxiliary action binding");
    eq(p.dependencies, [s.workUnit, s.proposal], "Action dependencies");
    for (const r of env.projectRefs?.(pid, 4096, false) ?? []) {
      const old = env.lookup(r) as NodePacket<DesignArtifact<any>> | null;
      if (
        old?.payload.kind === "auxiliary-action" &&
        old.id !== p.id &&
        old.payload.state.session === s.session &&
        old.payload.state.actionId === s.actionId
      )
        throw Error("Duplicate auxiliary action identity");
    }
  } else {
    const s = parseBridge(state),
      q = auxiliaryOwn(
        env,
        pid,
        s.request,
        "reconstruction-request",
        s.requestHash,
      ) as NodePacket<DesignArtifact<any>>;
    if (
      !same(s.workUnit, parseReconstructionRequest(q.payload.state).workUnit) ||
      s.tools.some((c) => !(bridgeTools as readonly string[]).includes(c.name))
    )
      throw Error("Auxiliary bridge binding/tools");
    eq(
      p.dependencies,
      [s.workUnit, s.request, ...(s.result ? [s.result] : [])],
      "Bridge dependencies",
    );
    if (previous) {
      const old = parseBridge((previous.payload as DesignArtifact<any>).state);
      eq(
        {
          ...s,
          status: old.status,
          result: old.result,
          detail: old.detail,
          tools: old.tools,
        },
        old,
        "Frozen bridge inputs changed",
      );
      if (
        (old.status !== "running" &&
          !["cancelled", "expired"].includes(old.status)) ||
        (old.status !== "running" && s.status !== "historical")
      )
        throw Error("Bridge cannot resume");
    }
    if (s.result) {
      const result = auxiliaryOwn(
        env,
        pid,
        s.result,
        "reconstruction-result",
      ) as NodePacket<DesignArtifact<any>>;
      if (!same(result.payload.state.request, s.request))
        throw Error("Bridge result binding");
    }
  }
}
const sameToken = (a: unknown, b: unknown) => canonical(a) === canonical(b);
