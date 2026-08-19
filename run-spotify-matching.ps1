# Repeatedly calls the match-spotify Edge Function until every track has
# been checked. Run this from PowerShell (needs internet access).
#
# Usage: .\run-spotify-matching.ps1 -FunctionUrl "https://<project-ref>.functions.supabase.co/match-spotify"

param(
    [Parameter(Mandatory=$true)]
    [string]$FunctionUrl
)

$totalChecked = 0
$totalMatched = 0
$consecutiveRateLimits = 0

while ($true) {
    try {
        $response = Invoke-RestMethod -Uri "$FunctionUrl`?limit=20" -Method Get
    } catch {
        Write-Host ">>> Request failed: $_. Waiting 30s and retrying..."
        Start-Sleep -Seconds 30
        continue
    }

    $response | ConvertTo-Json -Compress | Write-Host

    $checked = if ($response.checked) { $response.checked } else { 0 }
    $matched = if ($response.matched) { $response.matched } else { 0 }
    $totalChecked += $checked
    $totalMatched += $matched
    Write-Host ">>> running totals: checked=$totalChecked matched=$totalMatched"

    if ($response.done -eq $true) {
        Write-Host ">>> All tracks checked. Done."
        break
    }

    if ($response.rateLimited -eq $true) {
        $consecutiveRateLimits++
        $baseWait = if ($response.retryAfterSeconds) { [int]$response.retryAfterSeconds } else { 30 }

        # If Spotify wants us to wait more than 10 minutes, this is an
        # extended block, not normal throttling -- don't sit here retrying
        # for hours, that risks making it worse. Stop and tell the user.
        if ($baseWait -gt 600) {
            $hours = [Math]::Round($baseWait / 3600, 1)
            Write-Host ""
            Write-Host ">>> Spotify has issued an extended rate-limit block (~$hours hours)."
            Write-Host ">>> Stopping now rather than retrying during the block window."
            Write-Host ">>> Re-run this script after the wait has passed."
            break
        }

        $wait = [Math]::Min($baseWait * $consecutiveRateLimits, 300)  # cap normal backoff at 5 minutes
        Write-Host ">>> Spotify rate limit hit (x$consecutiveRateLimits in a row), waiting ${wait}s before retrying..."
        Start-Sleep -Seconds $wait
    } else {
        $consecutiveRateLimits = 0
        # A small pause between every successful batch, not just after
        # hitting a limit -- spreads requests out so we're less likely to
        # trip the burst threshold that caused the extended block.
        Start-Sleep -Seconds 3
    }
}
