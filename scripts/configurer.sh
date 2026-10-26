#!/bin/sh
# Configuration privee : ce script ne remplace jamais un fichier existant.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -e "$ROOT/.env" ]; then
  printf '%s\n' 'Le fichier .env existe deja. Aucune modification.'
  exit 0
fi
if [ "$(id -u)" -eq 0 ]; then
  printf '%s\n' 'Lance ce script avec ton utilisateur habituel, sans sudo. Sinon configure PUID/PGID manuellement dans .env.example.'
  exit 1
fi
command -v openssl >/dev/null 2>&1 || { printf '%s\n' 'OpenSSL est necessaire. Copie sinon .env.example vers .env et choisis ton mot de passe.'; exit 1; }
PASSWORD=$(openssl rand -hex 24)
umask 077
sed -e "s/CHANGE_ME_WITH_A_LONG_RANDOM_PASSWORD/$PASSWORD/" -e "s/^PUID=1000/PUID=$(id -u)/" -e "s/^PGID=1000/PGID=$(id -g)/" "$ROOT/.env.example" > "$ROOT/.env"
printf '%s\n' 'Fichier .env cree avec un mot de passe aleatoire.' 'Renseigne OPENAI_API_KEY dans .env et conserve APP_PASSWORD pour te connecter.' 'Puis lance : docker compose up -d --build'
