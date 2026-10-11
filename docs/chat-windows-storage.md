# Private local account storage

This change replaces the blanket Windows account prohibition with a checked native storage boundary.
Connection remains disabled unless a protected coordinator policy supplies actual local-use/license,
model and bounded-turn decisions. No default policy, account sign-in, model call or paid fallback is
created. The UI remains available offline without creating account storage merely on startup.

## Storage boundary

`private-storage.ts` delegates Windows filesystem operations to a fixed bundled PowerShell 5.1/.NET
Framework helper. No user command text is executed. JSON paths/data use pipes; credentials are never
command-line arguments or repeated in error messages. Native PowerShell is launched hidden and without
profiles. The helper timeout is 15 seconds; unavailable/blocked helpers reject the account operation.

On local NTFS/ReFS, new private directories/files are created with a protected DACL, current-user
ownership and one explicit current-user FullControl rule. Directories pass that rule to their children.
Reads and replacements validate owner, inheritance protection, rule identity/type/rights and path
components. Broad/inherited permissions, foreign ownership, reparse paths, hard-linked JSON files,
network paths and volumes without the required ACL support are rejected. Existing unsafe permissions
are never silently repaired. Temporary files start private, use exclusive creation and are flushed
before atomic replacement; cleanup retains the prior file if replacement fails.

The account's host identity, credentials and turn budget use this storage layer. The owned app-server
directory and restricted catalogue also use it. Credentials become active only after protected
persistence succeeds. Token use rechecks credential storage. OAuth callback processing rechecks its
policy/storage prerequisites. State/nonce/PKCE, signature/subject binding and scoped tools remain.
POSIX requires current ownership, private directory/file modes and no linked paths.

Policy files inside any detected Git repository/worktree are refused, even under ignored directories.
This is local OS access control, not encryption or protection from an administrator, backup privileges
or another process running as the same user. Use a trusted user-owned runtime hierarchy, not a shared
writable location; stop the runtime before copying it. Do not claim protection against malicious
concurrent replacement of ancestor directories or a compromised OS/user session.

Microsoft documents [creation-time security descriptors and default inheritance](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)
and [protected access rules](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.objectsecurity.setaccessruleprotection?view=netframework-4.8.1).

## Prepare an authorized trial

Use a fresh runtime outside Git and a dedicated private policy directory. In PowerShell, after the
coordinator has supplied the reviewed policy JSON, run:

```powershell
Get-Content -LiteralPath 'C:\absolute\reviewed-policy.json' -Raw |
  node scripts/prepare-chat-policy.ts 'C:\absolute\fresh-private-policy'
```

The utility creates `trial-policy.json` with the required platform permissions. It does not authorize
the contents or contact a provider. Set `BVE_CHAT_POLICY_FILE` to that absolute file and use the exact
pinned binary. Refer to [account setup](chat-workspace.md#account-setup-gate) for policy fields and
interactive sign-in. Do not fill review fields with fixture claims, reset a consumed budget by editing
policy, reuse another application's tokens or substitute a binary/model without a fresh boundary check.

An old account directory created with inherited Windows permissions will fail when used for sign-in.
Keep it and its runtime intact for recovery; use a fresh dedicated trial runtime instead of weakening
validation or recursively changing a user's existing storage. If credentials were already exposed,
disconnect the app in ChatGPT Settings before reauthorization.

## Verification and limits

Eight new controls cover protected creation/replacement, Unicode and literal paths, broadened file
permissions, directory inheritance, hard links/junction ancestors, sanitized helper/JSON failures,
actual ChatAuth policy/credential checks and budget restart, and Git/worktree exclusion. On Windows,
an actual anonymous-token read is denied, followed by a successful owner read. That OS-specific test
is skipped on POSIX; all other controls run on both platforms.

The signed OAuth/renewal fixtures, process-cancellation boundaries, 190 retained tests and all nine
browser workflows remain. Windows local execution passes 198 tests with no fail/skip/cancel, build,
typecheck, both smokes, fixture equality, all nine Edge workflows and original R1–R4 probes. Actual
account/model/image/GPU calls are zero. Exact-head CI and final return are recorded separately.

Rollback is prior source `5e06aa276dcdd7a29667b311da4b6be08534bacc` with its matching complete private
runtime backup. Keep newly created private trial storage separately; do not downgrade it in place.
Prior source reinstates the Windows prohibition. Integration acceptance and release remain separate.
