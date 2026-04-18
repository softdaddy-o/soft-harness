[CmdletBinding()]
param(
    [ValidateSet('codex', 'claude', 'both')]
    [string]$Host = 'both',
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
    & node (Join-Path $tempRoot 'scripts\install-plugin.js') "--target=$Target" "--host=$Host" "--source-root=$tempRoot"
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item $tempRoot -Recurse -Force
    }
}
