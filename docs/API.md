# API HTTP

Toutes les routes sauf `/health` exigent HTTP Basic avec APP_USERNAME / APP_PASSWORD. Le navigateur utilise la même origine que le serveur. Les requêtes d'écriture sont `Content-Type: application/json` et ne doivent pas venir d'une autre origine. Une réponse d'erreur est `{ "error": "message en français" }`.

## Routes

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/health` | Vivacité du processus, pas un test de validité de la clé IA |
| GET | `/api/vocabulary` | words, settings, revision et storage=csv |
| POST | `/api/vocabulary` | action add, add_many, import, update, delete, favorite ou review |
| GET | `/api/settings` | Paramètres |
| PATCH | `/api/settings` | goal (5,10,15,20), theme (dark,light) |
| GET | `/api/export` | Vocabulaire CSV, sans historique détaillé des événements |
| GET | `/api/backup` | ZIP de tous les CSV, pris dans une même lecture sérialisée |
| GET | `/api/export/file?name=lecons.csv` | Export d'un des onze fichiers autorisés |
| GET | `/api/ai/status` | configured, model, daily_limit, max_output_tokens, statistiques |
| POST | `/api/ai/generate` | Génération OpenAI explicite et sauvegarde |
| GET | `/api/learning` | Leçons et scores, dernières corrections, usage IA |
| GET | `/api/learning/lesson?id=...` | Cours et questions ; correction révélée après une réponse enregistrée |
| POST | `/api/learning/answer` | Corrige le choix sur le serveur et enregistre le résultat |

Le carnet n'est pas une API multi-utilisateurs. Les identifiants ouvrent le même carnet personnel depuis tous les appareils. Le champ theme accepte light pour compatibilité des données, mais cette interface est volontairement sombre et ne propose pas de bascule claire.

## Ajouter ou importer du vocabulaire

```json
{
  "action": "add",
  "word": {
    "english": "although",
    "french": "bien que",
    "category": "Grammaire",
    "example": "Although it is difficult, I keep practising.",
    "example_fr": "Bien que ce soit difficile, je continue de pratiquer.",
    "note": "Exprime une concession.",
    "source": "Ajout personnel"
  }
}
```

Pour importer du CSV : `{"action":"import","csv":"english,french\nhello,bonjour\n"}`. Les doublons anglais/français ne sont pas écrasés. Pour modifier un mot, fournir action=`update`, id et word contenant seulement les champs édités. Le serveur conserve la progression.

Pour enregistrer une révision : `{"action":"review","id":"identifiant-du-mot","rating":"good","event_id":"identifiant-unique-de-la-reponse"}`. Valeurs de rating : again, good, easy. En cas de renvoi, conserver event_id.

## Générer avec OpenAI

```json
{
  "request_id": "un-identifiant-unique-pour-cette-demande",
  "kind": "vocabulary",
  "mode": "words",
  "text": "although\ndeadline\nkeep in mind",
  "level": "B1",
  "count": 8,
  "use_vocabulary": false
}
```

- `kind` : vocabulary, lesson, correction.
- `mode` : words ou theme pour le vocabulaire.
- `text` : 1 à 3 000 caractères ; en mode words, 12 lignes non vides maximum.
- `level` : A1, A2, B1, B2, C1.
- `count` : entier entre 1 et 12, utilisé en mode theme.
- `use_vocabulary` : true envoie jusqu'à vingt mots à revoir pour personnaliser le contenu.
- `request_id` : 1 à 100 lettres ASCII, chiffres, tirets ou underscores. Le même identifiant + le même contenu déjà terminé renvoie le résultat sauvegardé sans appel externe. Ne pas réutiliser un identifiant pour une autre demande.

Le navigateur n'envoie jamais la clé OpenAI à cette route. Celle-ci la lit dans sa configuration serveur. Les réponses contiennent kind, request_id et, selon le cas, added/skipped, lesson ou correction. Les contenus sont enregistrés avant la réponse de succès.

## Répondre à un quiz de cours

```json
{
  "id": "identifiant-unique-de-cette-reponse",
  "exercise_id": "starter-question-01",
  "selected_index": 2
}
```

Les indices vont de 0 à 3. La réponse serveur contient correct, correct_index et explanation. Le client ne peut pas imposer la bonne réponse ni modifier directement le score. Le même identifiant/choix peut être renvoyé sans doubler l'historique. Recommencer le quiz crée de nouvelles tentatives.

## Statuts utiles

400 : entrée invalide. 401 : authentification du site requise. 404 : ressource inconnue. 409 : requête en cours ou identifiant incohérent. 413 : volume trop important. 422 : refus de contenu IA. 429 : quota local/fournisseur ou limite de connexion. 502 : erreur de clé/modèle/réponse OpenAI. 503 : IA non configurée ou stockage inaccessible. 504 : délai ou réseau externe.

Une clé OpenAI refusée donne 502 et non 401 : ne pas confondre le mot de passe du site avec la clé du fournisseur. `configured:true` indique seulement qu'une clé est présente, pas qu'un appel réel a réussi.


## Bibliotheque v3

Toutes ces routes exigent les memes identifiants que le carnet.
- GET /api/library : compteurs et collections.
- GET /api/library/collection?id=... : mots ou fiches d'une collection.
- POST /api/library/preview : {kind, csv, title, filename, level?, description?}. kind vaut vocabulary ou grammar. Valide sans ecrire.
- POST /api/library/import : meme corps ; revalide et enregistre en transaction.
- POST /api/library/progress : {id, status}. Statuts : new, learning, done.
- POST /api/library/scan : corps {} ; lit uniquement les deux sous-dossiers de IMPORT_DIR, retourne un bilan par fichier.
- GET /api/library/template?kind=grammar|vocabulary : modele CSV.
- GET /api/library/export?id=... : export CSV reimportable d'une collection.

Deux vues calculees : all-vocabulary et all-grammar. Les autres IDs sont fournis par l'API. Les erreurs sont retournees sous {error}, avec statut 400/401/403/404/413/503 selon leur nature.
