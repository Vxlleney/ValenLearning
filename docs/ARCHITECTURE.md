# Extension v3

La bibliotheque ajoute backend/library.js (import, validation, classement, lecture du dossier), trois tables CSV et une migration depuis les schemas 3 ou 8 fichiers. Le composant frontend/src/components/learning-library.jsx gere les deux onglets, les collections, le suivi et la confirmation d'import. Les donnees de vocabulaire ne sont pas recopiees ; collection-elements.csv reference les IDs existants. Le lecteur de lecons est partage avec l'Atelier IA.

# Architecture et décisions

## 1. Un serveur, plusieurs clients

L'application est un monolithe web personnel : React dans le navigateur, API HTTP Node.js native, fichiers CSV sur un disque local. Le même serveur sert les fichiers compilés et l'API. Aucune connexion directe navigateur/OpenAI, aucune clé dans le bundle frontend, aucun stockage de progression dans localStorage.

```text
valen-learning/
  frontend/
    src/App.jsx                 navigation, carnet, tableau de bord
    src/components/ui/          composants shadcn/ui
    src/components/ai-studio.jsx atelier IA, bibliotheque et quiz de cours
    src/components/learning-games.jsx   jeux de vocabulaire
    src/hooks/use-vocabulary.js chargement, mutations et synchronisation
    src/lib/api.js              client HTTP relatif
    public/                     logo et icone
  backend/
    index.js                    configuration et demarrage
    server.js                   HTTP, authentification, routes, fichiers statiques
    storage.js                  queue d'ecriture, CSV, transactions, reprise
    csv.js                      parseur/serialiseur strict
    actions.js                  mutations du carnet
    learning-state.js           lecons, corrections, reponses, quota IA
    ai.js                       client OpenAI et validation de ses reponses
    zip.js                      sauvegarde des CSV
    tests/                      tests node:test, fournisseur IA simule
  shared/vocabulary.js          validation, import, repetition espacee
  data/                         onze fichiers CSV persistants
  exemples/                     jeux de donnees d'initialisation/reference
  scripts/                      configuration, developpement, verification
  docs/                         exploitation et API
  compose.yaml / Dockerfile     build et execution
```

## 2. Pourquoi un backend avec des CSV ?

Un frontend React seul ne peut pas servir de carnet central partagé et écrire librement dans un fichier sur un autre ordinateur. Le backend est donc responsable de chaque lecture et écriture. CSV reste un format d'échange lisible, mais exige des mesures explicites pour la cohérence que fournirait autrement une base de données.

Toutes les mutations sont validées et **sérialisées dans une queue du processus Node**. Une requête reçoit l'état courant, applique son action, valide les nouveaux CSV, puis écrit. Deux appareils peuvent donc ajouter/réviser sans remplacer l'ensemble du carnet par une vieille copie cliente. Une modification concurrente du même texte suit la dernière écriture acceptée ; il n'y a pas d'édition collaborative caractère par caractère.

La queue est **locale à ce processus** : un seul conteneur pour un dossier de données. Ne pas utiliser de cluster, PM2 multi-processus, réplication ou plusieurs serveurs sur un même volume CSV. Le cas d'usage visé est personnel, sur disque local. Un partage NFS/SMB ou un dossier synchronisé par un service cloud n'est pas une configuration validée.

## 3. Transactions et reprise

Une sauvegarde logique comprend les onze CSV, jamais seulement une partie de la progression. Le stockage :

1. Sérialise et revalide tous les fichiers en mémoire.
2. Écrit des fichiers CSV temporaires distincts et synchronise les fichiers et le répertoire.
3. Crée un journal `.transaction.csv` contenant les noms attendus et leurs empreintes SHA-256.
4. Renomme chaque temporaire vers sa destination, puis supprime le journal après synchronisation.

Le journal durable est le point de validation logique. Si le processus s'interrompt après ce point, la lecture suivante termine l'opération avec les fichiers temporaires ou les destinations déjà remplacées, en vérifiant les empreintes. Un journal incohérent ou un CSV invalide provoque une erreur, pas une réinitialisation. Les lectures API et les sauvegardes passent aussi par la queue. Cela ne dispense pas de sauvegardes hors de la machine et ne garantit pas une protection contre une panne physique du disque.

Les journaux de l'ancienne version (trois CSV) sont reconnus. La migration est acceptée seulement pour l'ensemble complet d'origine sans tables nouvelles ; une nouvelle installation partiellement amputée est refusée.

## 4. Données normalisées en CSV

Une ligne par mot, révision, cours, question, réponse, correction ou appel IA. Les options d'un QCM ont quatre colonnes explicites. Les historiques ne sont pas des objets JSON cachés dans une cellule. CSV gère correctement guillemets, virgules et textes multilignes. Les cellules susceptibles d'être interprétées comme une formule de tableur sont préfixées et décodées à la lecture.

Les identifiants sont opaques et stables. Le marqueur `wordbloom-v1` est conservé pour la compatibilité des anciens exports de vocabulaire ; ce n'est pas la version de l'application. Les dates sont ISO UTC, le calcul du jour IA utilise Europe/Paris. Les schémas exacts sont dans `backend/storage.js` et `backend/learning-state.js`.

Plafonds : 5 000 mots, import 2 Mo, 10 Mo pour l'ensemble des CSV. L'historique d'un mot conserve au plus ses 1 000 derniers événements tandis que les compteurs restent cumulatifs. Les nouvelles tables sont plafonnées à 50 000 lignes chacune et restent soumises à la limite globale. Le journal d'utilisation n'est pas purgé automatiquement.

## 5. Révisions

Les jeux existants utilisent les fiches enregistrées sans IA. Une révision porte un identifiant d'événement afin qu'un renvoi de la même action ne double pas les compteurs. La répétition espacée est un algorithme simple du projet, pas une certification d'un modèle scientifique de mémorisation. Le choix « À revoir » reprogramme le mot rapidement, les réponses positives espacent les prochaines révisions. Les quiz de leçons ont leur propre historique et un calcul de score sur la dernière tentative par question.

La prononciation utilise SpeechSynthesis. Les voix locales peuvent fonctionner hors Internet mais toutes les voix ne sont pas locales. Aucune reconnaissance de la voix de l'apprenant n'est incluse.

## 6. Cycle d'un appel IA

Avant tout appel, le serveur valide la requête et réserve une entrée dans `utilisation-ia.csv`. Cette réservation persiste avant la consommation externe. Un identifiant de demande est associé à une empreinte de contenu ; un identifiant terminé peut retourner son résultat sans nouvel appel. Une réutilisation avec un contenu différent est refusée. Le client ne fait pas de relance automatique payante.

L'appel Responses se fait via `fetch` natif, avec une URL OpenAI fixe, une limite de temps et une sortie JSON Schema stricte. La réponse est encore validée localement. Les refus, sorties incomplètes et contenus mal formés ne sont pas importés. Le contenu et le statut final de la demande sont sauvegardés ensemble.

Il n'existe pas de transaction distribuée entre OpenAI et le disque local : une interruption après la facturation externe mais avant la sauvegarde peut laisser une demande en attente sans contenu utilisable. Le projet n'envoie pas automatiquement un second appel. Consulte l'état avant de relancer une génération. Une attente obsolète ne bloque pas le carnet indéfiniment ; une nouvelle requête pourra être soumise après le délai de protection. Un nouvel identifiant constitue une nouvelle demande potentiellement payante.

Les plafonds locaux sont des garde-fous, pas une garantie de budget ou de non-facturation d'une requête interrompue. Les tokens affichés dépendent des métadonnées reçues ; un appel dont la réponse est perdue peut être facturé sans compteur de tokens local.

## 7. Sécurité

Mot de passe long exigé en production, comparaison des identifiants côté serveur, limitation des échecs d'authentification par adresse directe, contrôle d'origine des mutations, aucune politique CORS permissive, limite de corps de requête, en-têtes CSP et anti-framing, validation des chemins statiques et liste blanche des exports. Les données et secrets ne sont pas dans le répertoire public. Les limites d'échecs de connexion sont en mémoire et reviennent à zéro au redémarrage. Derrière un proxy, elles peuvent être partagées par les clients qui ont la même adresse directe.

Le conteneur est non-root, en lecture seule sauf `data` et `/tmp`, sans capacités Linux supplémentaires. La clé est en variable d'environnement du serveur : les administrateurs de l'hôte/Docker peuvent néanmoins la consulter. Le dossier de données n'est pas chiffré par l'application ; utiliser les protections du disque et les permissions du système.

Ce n'est ni un audit de sécurité externe, ni une solution multi-tenant. HTTPS/VPN est indispensable au-delà d'un LAN de confiance. HTTP Basic seul ne chiffre rien et ne propose pas de bouton de déconnexion fiable : sur un appareil partagé, utiliser une session privée puis la fermer.
