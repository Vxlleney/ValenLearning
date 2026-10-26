# Valen Learning 3 — Démarrage

Installation existante : lire d'abord `MISE-A-JOUR-V3.md`. Ne remplace pas ton dossier de données par l'exemple du ZIP.

Installation neuve :

1. Décompresse le ZIP sur une seule machine qui servira tous tes appareils.
2. Copie `.env.example` vers `.env`, puis renseigne un mot de passe personnel (12 caractères minimum). Ajoute ta clé dans `OPENAI_API_KEY` uniquement pour utiliser la génération IA.
3. Exécute `docker compose up -d --build` depuis le dossier du projet.
4. Ouvre `http://localhost:8080` sur le serveur, ou `http://IP_DU_SERVEUR:8080` sur un autre appareil du même réseau.
5. Ouvre **Ma bibliothèque**, puis **Vocabulaire** ou **Grammaire**.
6. Pour un nouveau CSV : **Importer un CSV → Vérifier → Confirmer**. Ou dépose le fichier dans `imports/vocabulaire` / `imports/grammaire` et clique **Lire le dossier imports**.
7. Révise tes mots avec les jeux. Ouvre une fiche de grammaire et marque ton suivi. Les données sont partagées par les appareils qui utilisent ce serveur.
8. Fais une sauvegarde complète régulièrement.

Le ZIP contient 70 mots/expressions, 32 révisions, 14 leçons (dont 12 nouvelles fiches) et les 10 questions des deux leçons de départ. Les sept collections CSV sont déjà classées. Le serveur reste nécessaire pour les utiliser.

L'ancien site `chatgpt.site` n'a pas reçu les nouveaux onglets : seul son carnet a été enrichi. Cette archive est la version auto-hébergeable mise à jour. Consulte `VERIFICATIONS.md` pour les tests réellement effectués et les limites du build.
