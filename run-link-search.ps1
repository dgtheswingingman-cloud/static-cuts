# Repeatedly calls the find-possible-links Edge Function until every
# unmatched track has been searched.
#
# Usage: .\run-link-search.ps1 -FunctionUrl "https://<project-ref>.functions.supabase.co/find-possible-links"

param(
    [Parameter(Mandatory=$true)]
    [string]$FunctionUrl
)

$totalChecked = 0
$totalFound = 0
$consecutiveRateLimits = 0

while ($true) {
    try {
        $response = Invoke-RestMethod -Uri "$FunctionUrl`?limit=15" -Method Get
    } catch {
        Write-Host ">>> Request failed: $_. Waiting 30s and retrying..."
        Start-Sleep -Seconds 30
        continue
    }

    $response | ConvertTo-Json -Compress | Write-Host

    $checked = if ($response.checked) { $response.checked } else { 0 }
    $found = if ($response.found) { $response.found } else { 0 }
    $totalChecked += $checked
    $totalFound += $found
    Write-Host ">>> running totals: checked=$totalChecked found=$totalFound"

    if ($response.done -eq $true) {
        Write-Host ">>> All unmatched tracks searched. Done."
        break
    }

    if ($response.rateLimited -eq $true) {
        $consecutiveRateLimits++
        $wait = [Math]::Min(30 * $consecutiveRateLimits, 300)
        Write-Host ">>> Rate limited (x$consecutiveRateLimits in a row), waiting ${wait}s..."
        Start-Sleep -Seconds $wait
    } else {
        $consecutiveRateLimits = 0
        Start-Sleep -Seconds 2
    }
}
