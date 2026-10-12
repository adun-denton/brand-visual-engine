# Windows PowerShell 5.1 / .NET Framework, invoked only by the fixed backend adapter.
# No user command text. Credentials use stdin/stdout pipes, never command-line arguments.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$sidType = [Security.Principal.SecurityIdentifier]

function Check-Path([string]$path) {
    if ($path -notmatch '^[A-Za-z]:\\' -or $path.Substring(2).Contains(':')) { throw 'Local path required' }
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($path))
    if ($drive.DriveFormat -notin @('NTFS', 'ReFS')) { throw 'ACL-capable local volume required' }
    $part = $path
    while ($part) {
        if ([IO.File]::Exists($part) -or [IO.Directory]::Exists($part)) {
            if (([IO.File]::GetAttributes($part) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point' }
        }
        $part = [IO.Path]::GetDirectoryName($part)
    }
}
function New-Security([bool]$directory) {
    if ($directory) { $acl = [Security.AccessControl.DirectorySecurity]::new() }
    else { $acl = [Security.AccessControl.FileSecurity]::new() }
    $acl.SetOwner($identity)
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = [Security.AccessControl.InheritanceFlags]::None
    if ($directory) { $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,
        [Security.AccessControl.FileSystemRights]::FullControl, $inherit,
        [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    return $acl
}
function Check-Private([string]$path, [bool]$directory) {
    Check-Path $path
    if ($directory) {
        if (![IO.Directory]::Exists($path)) { throw 'Missing directory' }
        $acl = [IO.Directory]::GetAccessControl($path)
    } else {
        if (![IO.File]::Exists($path)) { throw 'Missing file' }
        $acl = [IO.File]::GetAccessControl($path)
    }
    if (!$acl.AreAccessRulesProtected -or $acl.GetOwner($sidType).Value -ne $identity.Value) { throw 'Unprotected owner/ACL' }
    $rules = @($acl.GetAccessRules($true, $true, $sidType))
    if ($rules.Count -ne 1) { throw 'Unexpected ACL rules' }
    $rule = $rules[0]
    if ($rule.IdentityReference.Value -ne $identity.Value -or $rule.IsInherited -or
        $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
        $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) { throw 'Unexpected access' }
    $expected = [Security.AccessControl.InheritanceFlags]::None
    if ($directory) { $expected = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' }
    if ($rule.InheritanceFlags -ne $expected) { throw 'Unexpected inheritance' }
}
function Ensure-Directory([string]$path) {
    Check-Path $path
    if (![IO.Directory]::Exists($path)) {
        $parent = [IO.Path]::GetDirectoryName($path)
        if (![IO.Directory]::Exists($parent)) { Ensure-Directory $parent }
        # The DACL is supplied at creation, before any secret can be written.
        $null = [IO.Directory]::CreateDirectory($path, (New-Security $true))
    }
    Check-Private $path $true
}
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $path = [IO.Path]::GetFullPath([string]$request.path)
    Check-Path $path
    $result = @{ ok = $true }
    switch ($request.operation) {
        'directory' { Ensure-Directory $path }
        'read' {
            Check-Private ([IO.Path]::GetDirectoryName($path)) $true
            Check-Private $path $false
            $result.data = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
        }
        'write' {
            $parent = [IO.Path]::GetDirectoryName($path)
            Check-Private $parent $true
            if ([IO.File]::Exists($path)) { Check-Private $path $false }
            elseif ([IO.Directory]::Exists($path)) { throw 'Not a file' }
            $temp = [IO.Path]::Combine($parent, '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
            $stream = $null
            try {
                $stream = [IO.FileStream]::new($temp, [IO.FileMode]::CreateNew,
                    [Security.AccessControl.FileSystemRights]::Write, [IO.FileShare]::None,
                    4096, [IO.FileOptions]::WriteThrough, (New-Security $false))
                $bytes = [Text.UTF8Encoding]::new($false).GetBytes([string]$request.data)
                $stream.Write($bytes, 0, $bytes.Length)
                $stream.Flush($true)
                $stream.Dispose(); $stream = $null
                Check-Private $temp $false
                if ([IO.File]::Exists($path)) { [IO.File]::Replace($temp, $path, [NullString]::Value) }
                else { [IO.File]::Move($temp, $path) }
                Check-Private $path $false
            } finally {
                if ($null -ne $stream) { $stream.Dispose() }
                if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
            }
        }
        default { throw 'Unknown storage operation' }
    }
    [Console]::Write(($result | ConvertTo-Json -Compress))
} catch {
    [Console]::Write('{"ok":false}')
    exit 1
}
