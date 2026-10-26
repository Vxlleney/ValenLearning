# Rapport de vérification — Valen Learning 3.0.0

Vérifications effectuées le 26 octobre 2026 avec Node.js 22.16.0. Ce rapport concerne les sources de l'archive. Il ne certifie pas un déploiement Docker ni un rendu sur tes appareils.

## Résultats exécutés

**47 tests serveur et d'intégration réussis, zéro échec**, avec `npm test`. Les 33 tests de la version précédente sont conservés et 14 tests de bibliothèque sont ajoutés. La sortie complète est fournie dans `docs/tests-resultat.txt`. Les 47 tests ont également été relancés avec succès après extraction de l’archive ; leur sortie est dans `docs/tests-archive-extraite.txt`.

Les nouveaux tests couvrent l'aperçu sans écriture, les imports sans doublon, la conservation de progression, les alias de colonnes, la grammaire multiligne, les suivis de leçons, les exports/réimports, les fichiers malformés, les limites, les écritures simultanées, les chemins et liens symboliques, les imports depuis le dossier serveur, la migration des huit CSV v2, le refus d'une sauvegarde incohérente et la reprise d'un journal interrompu. Des tests HTTP réels locaux exercent l'authentification et les protections d'origine.

Les tests IA existants utilisent des réponses **simulées** : aucun appel payant n'a été effectué et aucune clé privée n'est incluse.

| Contrôle | Résultat |
|---|---|
| 23 fichiers JSX, analyse syntaxique | Aucune erreur |
| 21 fichiers JS/MJS, analyse et `node --check` | Aucune erreur |
| 3 fichiers CSS, parsing PostCSS | Aucune erreur ; Tailwind non compilé |
| 113 imports relatifs ou alias locaux | Tous les chemins existent |
| Manifestes et package-lock | Version 3.0.0 cohérente |
| compose.yaml | Lecture YAML correcte, pas un `docker compose config` réel |
| Données fournies | 70 mots, 32 révisions, 14 leçons, 10 questions, 7 collections |
| Stockage | 11 fichiers CSV, sans base de données |
| Données livrées par HTTP local | 70 mots, 32 révisions, 14 leçons, 9 vues ; contrôles réussis |
| Deuxième scan des sources | 7 fichiers inchangés, aucun doublon |

## Limites importantes

- **Build React et vérification visuelle non exécutés.** `npm ci` n'a pas pu installer les dépendances : résolution DNS du registre npm indisponible (EAI_AGAIN) dans cet environnement. L'analyse syntaxique ne remplace pas le build Vite ni des tests d'interface.
- **Docker non exécuté.** Docker n'est pas installé ici. La construction de l'image, les montages et le démarrage doivent être validés sur ta machine.
- **OpenAI non testé avec une vraie clé.** L'intégration existante est conservée ; son usage nécessite ta configuration privée.
- **Nouveaux onglets non publiés sur l'ancien lien chatgpt.site.** Aucun outil de publication de cette interface n'était disponible. Seul le carnet hébergé a été enrichi de 16 entrées par le connecteur existant (70 entrées au total). Le ZIP est une version distincte, sans synchronisation automatique avec ce site.
- Les voix, le Wi-Fi, le pare-feu, les navigateurs des appareils, l'accès distant et HTTPS restent à tester chez toi. Pas d'audit externe de sécurité ni de garantie d'exploitation multi-utilisateur.

## Recette après installation

1. Sauvegarder l'ancienne installation et suivre `MISE-A-JOUR-V3.md` sans écraser son dossier `data`.
2. Lancer `docker compose up -d --build`, puis vérifier `docker compose ps` et les logs.
3. Ouvrir **Ma bibliothèque**, puis **Vocabulaire** et **Grammaire**.
4. Importer les modèles CSV depuis le navigateur, contrôler l'aperçu et réimporter le même fichier pour vérifier l'absence de doublon.
5. Lire une fiche, changer son statut, redémarrer et retrouver ce statut sur un autre appareil.
6. Déposer un CSV dans `imports`, cliquer **Lire le dossier imports**, puis consulter le bilan par fichier.
7. Faire une révision et exporter une sauvegarde complète de onze CSV.
8. Seulement pour tester l'IA, lancer une génération explicite avec ta clé : elle peut être facturée. Un indicateur de clé configurée n'est pas une preuve de connexion distante.
