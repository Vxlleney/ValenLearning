# Accès depuis un autre réseau

Le projet fonctionne directement sur ton LAN. Un ordinateur au travail ou un téléphone en 4G/5G ne peut pas joindre une adresse privée du domicile sans une configuration réseau complémentaire. Ne contourne pas la politique réseau de ton employeur.

## Option recommandée pour un usage personnel : réseau privé VPN

Installe une solution VPN que tu administres sur le serveur et les appareils autorisés. Connecte les appareils au même réseau privé virtuel et utilise l'adresse VPN du serveur avec le port 8080. N'autorise que tes appareils. Le VPN et sa configuration ne sont pas inclus dans ce projet, et ne démarrent pas automatiquement avec Compose.

## Option avancée : reverse proxy HTTPS

Pour un domaine que tu possèdes, un reverse proxy existant sur l'hôte peut terminer TLS et transmettre vers le port local. Ce choix exige DNS, certificat, pare-feu et maintenance. Le mot de passe reste indispensable.

Pour un reverse proxy **installé sur la même machine hôte**, limite dans `.env` le port applicatif à :

```dotenv
BIND_ADDRESS=127.0.0.1
APP_PORT=8080
```

Puis recrée le conteneur. Exemple indicatif de Caddyfile, à adapter à ton vrai domaine :

```caddyfile
anglais.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Il faut que le domaine pointe vers l'hôte et que la configuration TLS du proxy puisse fonctionner. Cet exemple n'est pas un déploiement distant préconfiguré. Un proxy lui-même en conteneur n'utilise pas `127.0.0.1` pour joindre un autre conteneur ; configure alors un réseau Docker interne et une cible de service adaptée, sans exposer le port applicatif.

Préserve le nom d'hôte HTTP d'origine lors du proxy : le backend vérifie l'origine des écritures. Teste l'ajout d'un mot et une sauvegarde après avoir mis en place HTTPS. Ne fais pas de redirection 8080 publique sans chiffrement et ne désactive pas les contrôles d'origine pour contourner une erreur de proxy.

Le projet ne fournit pas de domaine, d'hébergement permanent ou de tunnel public. La disponibilité dépend du serveur, de son accès Internet et de ton installation.
