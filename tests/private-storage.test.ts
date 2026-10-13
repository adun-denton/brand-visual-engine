import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertOutsideGit, ensurePrivateDirectory, readPrivateJson, writePrivateJson } from '../src/service/private-storage.ts';
import { ChatAuth } from '../src/service/chat-auth.ts';

const root = () => mkdtempSync(join(tmpdir(), 'bve-private-control-'));
const nativePs = (script: string, path: string) => execFileSync(
  join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
  ['-NoProfile', '-NonInteractive', '-Command', script],
  { input: JSON.stringify({path}), encoding: 'utf8', windowsHide: true },
).trim();
function broaden(path: string) {
  if (process.platform !== 'win32') { chmodSync(path, 0o644); return; }
  nativePs(`$p=([Console]::In.ReadToEnd()|ConvertFrom-Json).path
    $acl=[IO.File]::GetAccessControl($p)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),[Security.AccessControl.FileSystemRights]::Read,[Security.AccessControl.AccessControlType]::Allow))
    [IO.File]::SetAccessControl($p,$acl)`, path);
}
test('private JSON creation, replacement, Unicode/literal paths and permissions survive reopening without temporary remnants', () => {
  const dir = join(root(), "private ' $ ; [literal]");
  ensurePrivateDirectory(dir);
  const file = join(dir, 'credentials.json');
  writePrivateJson(file, {value: 'synthetic-only', label: 'طرح'});
  writePrivateJson(file, {value: 'synthetic-rotated', label: 'طرح'});
  ensurePrivateDirectory(dir);
  assert.deepEqual(readPrivateJson(file), {value: 'synthetic-rotated', label: 'طرح'});
  assert.deepEqual(readdirSync(dir), ['credentials.json']);
  if (process.platform === 'win32') {
    const acl = JSON.parse(nativePs(`$p=([Console]::In.ReadToEnd()|ConvertFrom-Json).path
      $a=[IO.File]::GetAccessControl($p)
      @{protected=$a.AreAccessRulesProtected;owner=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value;user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|ForEach-Object {@{sid=$_.IdentityReference.Value;inherited=$_.IsInherited;rights=[int]$_.FileSystemRights}})}|ConvertTo-Json -Depth 5 -Compress`, file));
    assert.equal(acl.protected, true); assert.equal(acl.owner, acl.user);
    assert.equal(acl.rules.length, 1); assert.equal(acl.rules[0].sid, acl.user);
    assert.equal(acl.rules[0].inherited, false); assert.equal(acl.rules[0].rights, 2032127);
  }
});
test('broadened file access is rejected on read and rotation without altering original bytes', () => {
  const dir = join(root(), 'private'); ensurePrivateDirectory(dir);
  const file = join(dir, 'credentials.json'); writePrivateJson(file, {secret: 'synthetic-no-account'});
  const before = readFileSync(file);
  broaden(file);
  assert.throws(() => readPrivateJson(file), /unprotected/);
  assert.throws(() => writePrivateJson(file, {secret: 'must-not-replace'}), /unprotected/);
  assert.deepEqual(readFileSync(file), before);
  assert.deepEqual(readdirSync(dir), ['credentials.json']);
});
test('Windows denies an actual anonymous-token read of a private file', {skip: process.platform !== 'win32'}, () => {
  const dir = join(root(), 'private'); ensurePrivateDirectory(dir);
  const file = join(dir, 'synthetic.json'); writePrivateJson(file, {value: 'synthetic-only'});
  const result = JSON.parse(nativePs(`$ErrorActionPreference='Stop'
    $p=([Console]::In.ReadToEnd()|ConvertFrom-Json).path
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AnonymousControl {
 [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentThread();
 [DllImport("advapi32.dll",SetLastError=true)] public static extern bool ImpersonateAnonymousToken(IntPtr thread);
 [DllImport("advapi32.dll",SetLastError=true)] public static extern bool RevertToSelf();
}
'@
    if(![AnonymousControl]::ImpersonateAnonymousToken([AnonymousControl]::GetCurrentThread())) {throw 'Anonymous control unavailable'}
    $denied=$false
    try {try {$s=[IO.File]::OpenRead($p);$s.Dispose()}catch [UnauthorizedAccessException] {$denied=$true}}
    finally {if(![AnonymousControl]::RevertToSelf()){throw 'Could not restore token'}}
    @{denied=$denied}|ConvertTo-Json -Compress`, file));
  assert.equal(result.denied, true);
  assert.deepEqual(readPrivateJson(file), {value: 'synthetic-only'});
});
test('unprotected directories and inherited Windows permissions fail closed rather than being silently repaired', () => {
  const dir = join(root(), 'private'); ensurePrivateDirectory(dir);
  if (process.platform === 'win32') {
    nativePs(`$p=([Console]::In.ReadToEnd()|ConvertFrom-Json).path
      $a=[IO.Directory]::GetAccessControl($p);$a.SetAccessRuleProtection($false,$true);[IO.Directory]::SetAccessControl($p,$a)`, dir);
  } else { chmodSync(dir, 0o755); }
  assert.throws(() => ensurePrivateDirectory(dir), /unprotected/);
  assert.throws(() => writePrivateJson(join(dir, 'new.json'), {}), /unprotected/);
  assert.equal(existsSync(join(dir, 'new.json')), false);
});
test('hard-linked files and linked directory ancestors cannot read or redirect private writes', () => {
  const base = root(), dir = join(base, 'private'); ensurePrivateDirectory(dir);
  const file = join(dir, 'original.json'); writePrivateJson(file, {value: 'synthetic'});
  const alias = join(dir, 'alias.json'); linkSync(file, alias);
  assert.throws(() => readPrivateJson(alias), /unprotected/);
  assert.throws(() => writePrivateJson(alias, {}), /unprotected/);
  const linked = join(base, 'linked'); symlinkSync(dir, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => ensurePrivateDirectory(join(linked, 'child')), /unprotected/);
  assert.equal(existsSync(join(dir, 'child')), false);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {value: 'synthetic'});
});
test('unsupported storage helper errors expose no file contents or command payload', () => {
  const dir = join(root(), 'private'); ensurePrivateDirectory(dir);
  const file = join(dir, 'invalid.json'); writePrivateJson(file, {value: 'synthetic-sensitive-value'});
  writeFileSync(file, 'invalid synthetic-sensitive-value');
  assert.throws(() => readPrivateJson(file), error => {
    assert.equal(String(error).includes('synthetic-sensitive-value'), false);
    return /unprotected/.test(String(error));
  });
  if (process.platform === 'win32') {
    const prior = process.env['SystemRoot']; process.env['SystemRoot'] = join(root(), 'absent-system');
    try { assert.throws(() => writePrivateJson(file, {value: 'synthetic-sensitive-value'}), /unprotected/); }
    finally { if (prior === undefined) delete process.env['SystemRoot']; else process.env['SystemRoot'] = prior; }
  }
});
test('real account policy requires protected storage and preserves its bounded budget across restart without any provider call', async () => {
  const base = root(), dir = join(base, 'coordinator-private'); ensurePrivateDirectory(dir);
  const file = join(dir, 'policy.json');
  const policy = {version: 1, eligibleLocalUseReview: 'Synthetic offline boundary', licenseReview: 'Offline only, no eligibility decision', model: 'gpt-6-luna', maxTurns: 2, noPaid: true, allowLogin: true, toolBoundaryReview: 'Synthetic'};
  writePrivateJson(file, policy);
  const prior = process.env['BVE_CHAT_POLICY_FILE']; process.env['BVE_CHAT_POLICY_FILE'] = file;
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; throw Error('No provider'); };
  try {
    const runtime = join(base, 'runtime');
    const auth = new ChatAuth(runtime, transport);
    assert.deepEqual(auth.policy(), policy);
    assert.ok(new URL(auth.begin('http://127.0.0.1:4987').url).searchParams.get('code_challenge'));
    auth.consumeTurn(); auth.consumeTurn();
    assert.throws(() => new ChatAuth(runtime, transport).consumeTurn(), /exhausted/);
    const credentialFile = join(runtime, 'chat-account-private/credentials.json');
    writePrivateJson(credentialFile, {client_id: 'synthetic', subject: 'synthetic', id_token: 'synthetic', access_token: 'synthetic-never-live', refresh_token: 'synthetic', scope: 'chatgpt.tokens.use.direct', expiresAt: Date.now() + 3600000});
    const loaded = new ChatAuth(runtime, transport);
    assert.equal(await loaded.token(), 'synthetic-never-live');
    broaden(credentialFile);
    await assert.rejects(loaded.token(), /unprotected/);
    assert.throws(() => new ChatAuth(runtime, transport), /unprotected/);
    broaden(file);
    assert.throws(() => auth.policy(), /unprotected/);
    assert.throws(() => auth.begin('http://127.0.0.1:4987'), /unprotected/);
    assert.equal(calls, 0);
  } finally { if (prior === undefined) delete process.env['BVE_CHAT_POLICY_FILE']; else process.env['BVE_CHAT_POLICY_FILE'] = prior; }
});
test('a Git worktree or repository ancestor cannot contain coordinator policy', () => {
  const repo = root(); mkdirSync(join(repo, '.git'));
  assert.throws(() => assertOutsideGit(join(repo, 'ignored/private/policy.json')), /outside Git/);
  const worktree = root(); writeFileSync(join(worktree, '.git'), 'gitdir: synthetic');
  assert.throws(() => assertOutsideGit(join(worktree, 'policy.json')), /outside Git/);
  assert.doesNotThrow(() => assertOutsideGit(join(root(), 'private/policy.json')));
});
