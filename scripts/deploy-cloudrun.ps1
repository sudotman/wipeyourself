Param(
  [Parameter(Mandatory = $true)] [string] $seekinfinitum,
  [string] $Region = "us-central1",
  [string] $ServiceName = "seek-api"
)

$ErrorActionPreference = "Stop"

gcloud config set project $seekinfinitum | Out-Null
gcloud run deploy $ServiceName `
  --source . `
  --region $Region `
  --allow-unauthenticated `
  --port 8080


.