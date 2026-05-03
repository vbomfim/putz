# Putz shell integration for PowerShell 7+ (pwsh)
# Emits OSC 7 (CWD reporting) and OSC 133 handshake on every prompt.
# Do NOT add OSC 133 ;A/B/C/D markers here — that is S4 scope.

if (-not (Get-Variable -Name '__PutzShellIntegrationLoaded' -Scope Global -ErrorAction SilentlyContinue)) {
    $global:__PutzShellIntegrationLoaded = $true
    $global:__PutzOriginalPrompt = $function:prompt
    function global:prompt {
        $cwd = (Get-Location).Path
        # Percent-encode the path for a valid file:// URI (preserve '/' separators)
        $encoded = [System.Uri]::EscapeDataString($cwd) -replace '%2F','/' -replace '%5C','\'
        Write-Host "`e]7;file://$($env:COMPUTERNAME ?? 'localhost')$encoded`a" -NoNewline
        Write-Host "`e]133;P;putz=1`a" -NoNewline
        & $global:__PutzOriginalPrompt
    }
}
