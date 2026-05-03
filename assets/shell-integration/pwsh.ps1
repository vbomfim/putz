# Putz shell integration for PowerShell 7+ (pwsh)
# Emits OSC 7 (CWD reporting) and OSC 133 handshake on every prompt.
# Do NOT add OSC 133 ;A/B/C/D markers here — that is S4 scope.

if (-not (Get-Variable -Name '__PutzOriginalPrompt' -Scope Global -ErrorAction SilentlyContinue)) {
    $global:__PutzOriginalPrompt = $function:prompt
    function global:prompt {
        $cwd = (Get-Location).Path
        Write-Host "`e]7;file://$($env:COMPUTERNAME ?? 'localhost')$cwd`a" -NoNewline
        Write-Host "`e]133;P;putz=1`a" -NoNewline
        & $global:__PutzOriginalPrompt
    }
}
