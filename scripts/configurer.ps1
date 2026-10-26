# Configuration locale : ne remplace jamais un fichier .env existant.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '.env'
if (Test-Path $target) { Write-Host 'Le fichier .env existe deja. Aucune modification.'; exit 0 }
$bytes = New-Object byte[] 24
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$password = [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').TrimEnd('=')
$content = [IO.File]::ReadAllText((Join-Path $root '.env.example'))
$content = $content.Replace('CHANGE_ME_WITH_A_LONG_RANDOM_PASSWORD', $password)
[IO.File]::WriteAllText($target, $content, (New-Object Text.UTF8Encoding($false)))
Write-Host 'Fichier .env cree avec un mot de passe aleatoire.'
Write-Host 'Ouvre .env, renseigne OPENAI_API_KEY et conserve APP_PASSWORD pour te connecter.'
Write-Host 'Puis lance : docker compose up -d --build'
