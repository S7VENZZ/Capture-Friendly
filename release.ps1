# Publishes a new version:  .\release.ps1 1.0.1
# Sets the version, runs the tests, commits, tags and pushes. GitHub Actions then builds the installer and creates the release.
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Run([scriptblock]$cmd, [string]$what) {
  & $cmd
  if ($LASTEXITCODE -ne 0) { throw "Fehlgeschlagen: $what (Exit-Code $LASTEXITCODE). Es wurde nichts weiter veröffentlicht." }
}

if (git status --porcelain) { throw 'Es gibt uncommittete Änderungen. Bitte erst committen (oder verwerfen).' }
if (git tag --list "v$Version") { throw "Das Tag v$Version gibt es schon." }

Run { node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='$Version';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')" } 'Version setzen'
if (Test-Path package-lock.json) {
  Run { node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package-lock.json','utf8'));p.version='$Version';if(p.packages&&p.packages['']){p.packages[''].version='$Version'}fs.writeFileSync('package-lock.json',JSON.stringify(p,null,2)+'\n')" } 'Lock-Datei anpassen'
}
Run { npm test } 'Tests'

Run { git add -A } 'git add'
Run { git commit -m "Release v$Version" } 'git commit'
Run { git tag "v$Version" } 'git tag'
Run { git push } 'git push'
Run { git push origin "v$Version" } 'git push (Tag)'

Write-Host "v$Version wurde gepusht. Der Installer wird jetzt von GitHub gebaut (ca. 2-5 Minuten): Actions -> Release."
