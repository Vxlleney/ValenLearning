# Passer de Valen Learning 2 à la bibliothèque v3

## Règle essentielle

Garde **ton propre `.env` et ton propre dossier `data` complet**. Le dossier `data` du nouveau ZIP est un instantané de démonstration personnalisé ; le copier par-dessus ton installation peut faire perdre les ajouts et révisions plus récents.

## Procédure conseillée

1. Dans ton ancien site, télécharge une **Sauvegarde complète**. Conserve aussi une copie privée de `.env`.
2. Dans le dossier de l'ancienne installation, exécute `docker compose down`. Cela arrête cette application ; le dossier `data` monté depuis ton ordinateur est conservé.
3. Décompresse le nouveau ZIP dans **un dossier distinct**.
4. Dans ce nouveau dossier, renomme le `data` fourni en `data-exemple`. Copie ensuite **tout ton ancien dossier `data`** dans le nouveau dossier du projet : il doit devenir `nouveau-projet/data` (et non `data/data`). Copie ton ancien `.env` à la racine.
5. Garde le nouveau dossier `imports` et les nouveaux fichiers de code, Dockerfile et compose.yaml. Les CSV d'exemple des séances y sont classés. Ils sont ajoutés sans écraser les mots ou résultats existants.
6. Dans le nouveau dossier, exécute `docker compose up -d --build`, puis `docker compose logs --tail=100 valen-learning`.
7. Ouvre ton adresse habituelle du serveur, recharge la page, puis **Ma bibliothèque**. Fais une nouvelle sauvegarde.

N'assemble pas les huit CSV d'une ancienne sauvegarde avec les trois nouveaux CSV préremplis du ZIP : leurs liens pourraient pointer vers des leçons absentes. Remplacer le dossier complet avant de démarrer évite ce problème.

## Ce que fait la migration

Si les huit CSV v2 sont présents et les trois nouveaux sont absents, le serveur crée les tables de classement vides dans une transaction. Il lit ensuite les CSV de `imports`. La progression existante et les anciens identifiants sont conservés. Une migration depuis la version à trois CSV est également prise en charge.

Si un seul fichier obligatoire est absent dans une installation partiellement migrée, le serveur refuse de la réinitialiser : restaure l'ensemble d'une sauvegarde cohérente. Ne supprime pas les fichiers cachés du journal d'une sauvegarde interrompue.

## Pour les ajouts suivants

Dépose un CSV dans `imports/vocabulaire` ou `imports/grammaire`, puis clique **Lire le dossier imports** dans le site. Pas besoin de rebâtir l'image ni de redémarrer. L'import par fichier/collage depuis le navigateur reste disponible.

## Ancien lien hébergé

Cette procédure concerne ton serveur Docker. Elle ne modifie pas le site privé sur `chatgpt.site` : la publication de son interface exige un accès distinct, indisponible pendant cette livraison.
