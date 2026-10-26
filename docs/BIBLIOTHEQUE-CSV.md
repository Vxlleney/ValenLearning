# Bibliothèque de leçons et formats CSV

## Organisation de l'écran

**Ma bibliothèque → Vocabulaire** : le carnet complet et les collections de mots. Ouvrir une collection affiche les traductions, les exemples, la prononciation et l'accès aux trois jeux. Les sessions utilisent le nombre de mots et le sens de traduction réglés dans M'entraîner.

**Ma bibliothèque → Grammaire** : toutes les leçons (dont l'Atelier IA) et les collections importées. Chaque fiche peut être marquée À découvrir, En cours ou Acquise. Ce suivi est manuel, distinct des résultats de QCM.

## Import depuis le site

Cliquer **Importer un CSV**, choisir Vocabulaire ou Grammaire, sélectionner le fichier ou coller son contenu. Donner un nom à la collection, puis **Vérifier le CSV**. L'aperçu affiche les nouvelles entrées et les doublons. **Confirmer l'import** enregistre la collection. Aucune génération OpenAI n'est lancée.

Les fichiers doivent être en **UTF-8** (le BOM est accepté). Séparateurs reconnus : virgule, point-virgule ou tabulation. Encadrer les cellules contenant le séparateur ou des retours à la ligne avec des guillemets doubles ; un guillemet dans la cellule s'écrit `""`.

### Vocabulaire

Obligatoires : `english` et `french` (alias `anglais` et `francais` acceptés).
Facultatives : `category,example,example_fr,note,source`.

```csv
english;french;category;example;example_fr;note;source
outage;panne / interruption de service;Informatique;The outage lasted twenty minutes.;La panne a duré vingt minutes.;A network outage.;Ma séance
```

La paire anglais/français identifie un mot ; un mot ayant une autre traduction peut devenir une nouvelle entrée. Un mot déjà présent est rattaché à la collection, sans écraser sa fiche, ses favoris ou ses résultats. Un réimport n'est pas un outil de modification de fiche : modifier le mot dans Mon vocabulaire.

### Grammaire

Obligatoires : `title` et `summary` (alias `titre` et `regle` acceptés).
Facultatives : `topic,level,structure,example,example_fr,common_mistake,tip,source`.
Niveaux acceptés : A1, A2, B1, B2, C1. B1 est utilisé si aucun niveau n'est indiqué et si aucun autre niveau par défaut n'est choisi.

```csv
title;topic;level;summary;structure;example;example_fr;common_mistake;tip;source
For et since;Durée;B1;For indique une durée, since un point de départ.;have/has + participe passé;I have worked here for three years.;Je travaille ici depuis trois ans.;Ne pas dire since three years.;For = combien de temps ?;Ma séance
```

**Une ligne = une fiche de grammaire.** Les colonnes d'exemples, structure et astuce deviennent des sections dans le corps de la fiche. Un CSV peut contenir plusieurs fiches. Les colonnes de QCM ne sont pas prises en charge par cet import : les fiches importées sont des cours sans quiz automatique. Les deux leçons de départ et les leçons créées dans l'Atelier IA gardent leurs exercices.

### Ajouter les fichiers au projet

```text
imports/vocabulaire/ma-seance.csv
imports/grammaire/mes-regles.csv
```

Le serveur lit les deux sous-dossiers au démarrage. Quand il tourne déjà, cliquer **Lire le dossier imports**. Ce n'est pas un observateur permanent des fichiers. Les sous-dossiers imbriqués et les liens symboliques ne sont pas lus. Maximum : 40 CSV par lecture.

Un fichier invalide ne bloque pas les autres : le bilan affiche chaque erreur. Un même contenu importé sous un autre nom ou avec un autre séparateur reste la même collection. Les titres des collections ne sont donc pas renommés par un réimport identique.

Pour la grammaire, modifier une règle produit une nouvelle fiche/collection au prochain import ; l'ancienne reste disponible avec son suivi. Aucun écrasement silencieux. Supprimer un CSV du dossier imports ne supprime pas son contenu déjà enregistré.

## Demandes à copier dans une conversation d'anglais

### Pour le vocabulaire

> Exporte uniquement le vocabulaire visible et effectivement travaillé dans cette conversation en CSV UTF-8, sans bloc Markdown, avec english,french,category,example,example_fr,note,source. Une ligne par paire de traductions. N'invente pas un historique que tu n'as pas retrouvé. Utilise un exemple original et indique sa provenance.

### Pour les leçons de grammaire

> Crée des fiches de révision à partir des notions de grammaire visibles dans cette conversation. Rends un CSV UTF-8 avec title,topic,level,summary,structure,example,example_fr,common_mistake,tip,source. Une ligne par fiche, les cellules contenant des virgules ou des retours à la ligne entre guillemets. Distingue ce qui a été travaillé et tes nouveaux exemples pédagogiques. Pas de QCM dans ce format.

## Exports

Dans une collection, **Exporter cette collection en CSV** donne un fichier réimportable. Les cellules susceptibles d'être interprétées comme des formules sont préfixées pour l'export tableur. Le marqueur `csv_format` permet de retirer ce préfixe lors d'un réimport de nos exports : garder cette colonne.

Une collection exportée n'est pas une sauvegarde complète du suivi. Utiliser **Sauvegarde complète**, qui inclut tous les CSV, pour conserver les relations, statuts et historiques de révision.
