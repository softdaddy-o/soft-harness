[CmdletBinding()]
param(
    [ValidateSet('codex', 'claude', 'both')]
    [string]$Host = 'both',
    [ValidateSet('release', 'claude')]
    [string]$Source = 'release',
    [string]$ClaudeHome = '',
    [string]$Target = '.',
    [string]$Repo = 'https://github.com/softdaddy-o/soft-harness.git',
    [string]$Ref = 'main'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'install failed: git is required'
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'install failed: node is required'
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("soft-harness-install-" + [System.Guid]::NewGuid().ToString('N'))

try {
    git clone --depth 1 --branch $Ref $Repo $tempRoot | Out-Null
    $nodeArgs = @(
        (Join-Path $tempRoot 'scripts\install-plugin.js'),
        "--target=$Target",
        "--host=$Host",
        "--source=$Source",
        "--source-root=$tempRoot"
    )
    if ($ClaudeHome) {
        $nodeArgs += "--claude-home=$ClaudeHome"
    }
    & node @nodeArgs
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item $tempRoot -Recurse -Force
    }
}
