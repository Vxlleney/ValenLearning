# Valen Learning 3.0 — Bibliothèque, CSV et OpenAI

Application personnelle d'apprentissage de l'anglais : React JavaScript/JSX, shadcn/ui, thème sombre et orange, serveur Node.js, Docker. Les données persistantes restent dans des CSV. Une seule installation dessert les PC et téléphones.

## Nouveau : Ma bibliothèque

Deux onglets séparent **Vocabulaire** et **Grammaire**. Chaque fichier importé devient une collection nommée. Les mots restent les mêmes que dans le carnet : on ne duplique pas leur progression.

- Vocabulaire : mots, traductions, exemples, prononciation et jeux ciblés sur la collection.
- Grammaire : cours lisibles, structure, exemples bilingues, erreurs à éviter et suivi « À découvrir / En cours / Acquise ». Les leçons qui disposent de questions gardent leur quiz.
- Import par fichier, glisser-déposer ou collage, avec vérification et aperçu avant confirmation. Modèles disponibles dans le site.
- Ajout de fichiers au projet via `imports/vocabulaire/` et `imports/grammaire/` : lecture au démarrage ou sur clic dans le site. Pas de reconstruction Docker pour un ajout de CSV.
- Export d'une collection et sauvegarde complète des données.

**Détail des formats : [docs/BIBLIOTHEQUE-CSV.md](docs/BIBLIOTHEQUE-CSV.md).**

## Installation neuve

Prérequis : Docker avec la commande `docker compose`. Décompresser ce dossier sur la machine qui servira l'application. Le dossier `data` fourni contient un instantané de départ ; ne pas l'utiliser pour remplacer une installation déjà en cours.

Créer `.env` :

```powershell
# Windows / PowerShell
Copy-Item .env.example .env
notepad .env
```

```bash
# Linux : le script prépare notamment un mot de passe aléatoire
sh scripts/configurer.sh
nano .env
```

Renseigner `APP_PASSWORD` (au moins 12 caractères, pas la valeur d'exemple). `APP_USERNAME` vaut `valentin` par défaut. Pour la génération IA, renseigner `OPENAI_API_KEY` côté serveur. **Ne jamais publier cette clé ni l'ajouter au code React ou aux CSV.** Les imports, le carnet, les jeux et les cours existants fonctionnent sans elle.

```bash
docker compose up -d --build
docker compose ps
```

Sur le serveur : `http://localhost:8080`. Sur un autre appareil du même réseau : `http://IP_DU_SERVEUR:8080`. Utiliser les identifiants de `.env`. Autoriser ce port uniquement sur le réseau privé dans le pare-feu. Le serveur doit rester allumé.

Ne pas installer des copies indépendantes sur chaque PC : elles auraient des carnets différents. Tous les appareils doivent ouvrir l'adresse du même serveur. Les vues du carnet et le catalogue de la bibliothèque se rafraîchissent environ toutes les 20 secondes quand elles sont visibles et inactives. Une fiche ouverte ou un quiz en cours n'est pas remplacé pendant la saisie ; revenir au catalogue pour relire une collection actualisée.

**Accès hors domicile :** voir [docs/ACCES-DISTANT.md](docs/ACCES-DISTANT.md). Ne pas exposer directement ce port HTTP sur Internet. Utiliser un accès privé ou un reverse proxy HTTPS configuré correctement. L'authentification HTTP Basic de ce projet n'assure pas le chiffrement du transport.

## Mettre à jour une installation existante

Lire **[MISE-A-JOUR-V3.md](MISE-A-JOUR-V3.md)** avant de copier les fichiers.

**Ne remplace pas tes données par le dossier `data` fourni dans ce ZIP.** Conserve ton propre `.env` et tout ton dossier `data`. La migration ajoute les trois CSV de classement en conservant les huit CSV de la version 2. La présence d'un CSV incomplet provoque un refus, jamais une réinitialisation silencieuse.

## Données et sauvegardes

```text
data/
  vocabulaire.csv             # Mots et compteurs
  revisions.csv               # Une ligne par révision
  parametres.csv              # Thème et objectif
  lecons.csv                  # Cours et fiches
  exercices.csv               # QCM associés aux cours
  resultats-exercices.csv      # Réponses aux QCM
  corrections.csv             # Textes corrigés
  utilisation-ia.csv           # Journal des appels IA
  collections.csv             # Collections importées
  collection-elements.csv     # Liens entre collections, mots et fiches
  suivi-lecons.csv             # Statut des fiches de grammaire
imports/
  vocabulaire/                # CSV à ajouter au carnet et à classer
  grammaire/                  # CSV de règles et exemples
```

Les onze fichiers de données sont inclus dans **Sauvegarde complète**. Les secrets `.env` et les fichiers sources `imports` ne sont pas inclus dans cette archive de données. Le contenu des imports est conservé sous forme normalisée dans les onze CSV : les originaux ne sont plus nécessaires pour lire les collections. Sauvegarder aussi `.env` de façon privée pour faciliter un déménagement du serveur.

Pour restaurer : arrêter le conteneur, garder une copie de l'ancien dossier, puis remplacer **l'ensemble** du dossier de données par les fichiers d'une même sauvegarde. Ne pas mélanger des CSV provenant de sauvegardes différentes. Redémarrer. Ne pas modifier les CSV de données avec Excel pendant l'exécution : utiliser les imports prévus.

## OpenAI et apprentissage

L'Atelier IA existant est conservé : ajout de vocabulaire, création de leçons avec QCM et correction de textes. Les nouvelles leçons se retrouvent aussi dans la vue « Toutes mes leçons ». La bibliothèque ne déclenche aucun appel IA pendant un import ou une lecture.

La clé reste dans le backend. `OPENAI_MODEL` et `AI_DAILY_LIMIT` sont configurables. Une clé présente n'est pas une connexion déjà testée. L'utilisation de l'API a sa propre facturation ; ne pas la confondre avec un abonnement ChatGPT. Voir les liens officiels dans `docs/SOURCES.md`.

Les exercices de vocabulaire ne sont pas des tests TOEIC officiels. Les niveaux des fiches sont des repères pédagogiques, pas une certification. Les 12 nouvelles fiches sont des synthèses originales basées sur les notions retrouvées dans les séances, pas une copie exhaustive de toutes les conversations.

## Limite avec le site ChatGPT hébergé

Ce ZIP est le projet auto-hébergeable. **Il ne publie pas automatiquement sur l'ancien lien `chatgpt.site` et ne se synchronise pas avec lui.** Dans cette session, 16 entrées de révision ont été ajoutées au carnet hébergé (70 au total), mais les nouveaux onglets n'ont pas pu y être déployés faute d'outil de publication accessible.

## Architecture et exploitation

Un serveur Node.js sert le frontend compilé et l'API sur la même origine. Aucune base SQL, aucun stockage de carnet dans localStorage. Une file d'écriture et un journal CSV coordonnent les modifications et leur reprise après interruption. Ne pas lancer plusieurs serveurs écrivains sur les mêmes fichiers : ce n'est pas un stockage distribué.

Limites applicatives : 5 000 mots au total ; 2 Mo par CSV importé ; 500 fiches par import de grammaire ; 40 fichiers par lecture du dossier ; 10 Mo pour les CSV persistants. Les imports invalides sont rejetés par fichier, sans annuler les autres fichiers valides du dossier. Le site affiche le bilan.

```bash
# Hors Docker pour le développement (Node 22.12+ ou 24)
npm ci
npm run dev
# Compiler le frontend
npm run build
# Tester le serveur : aucun appel IA payant
npm test
# Diagnostic Docker
docker compose logs --tail=100 valen-learning
```

Vérifications et limites réelles de cette livraison : [VERIFICATIONS.md](VERIFICATIONS.md). Le build n'a pas été validé dans l'environnement de préparation ; ne pas confondre tests serveur et test complet de Docker ou de l'interface.
