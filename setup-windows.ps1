$ErrorActionPreference = "Stop"
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
Write-Host "Apri .env e inserisci TOKEN, CLIENT ID e SERVER ID." -ForegroundColor Yellow
Write-Host "Poi salva il file e premi INVIO." -ForegroundColor Yellow
Read-Host
npm install
npm run build
npm run deploy-commands
Write-Host "Configurazione completata. Avvia con: npm run dev" -ForegroundColor Green
