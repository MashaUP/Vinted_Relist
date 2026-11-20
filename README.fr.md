# Vinted Relist

[🇮🇹 Italiano](README.md) · [🇬🇧 English](README.en.md) · **🇫🇷 Français** · [🇪🇸 Español](README.es.md) · [🇩🇪 Deutsch](README.de.md)

Extension pour **Brave et Chrome** qui republie vos annonces Vinted en un clic, une par une ou en
file d'attente, pour les remettre en tête des résultats sans les refaire à la main.

**Version 2.6.1** · [Nouveautés (en italien)](CHANGELOG.md) · [Communauté Discord](https://discord.gg/EPsbQCuAkx) ·
[Signaler un problème](https://github.com/MashaUP/Vinted_Relist/issues/new?template=segnalazione-bug.yml) ·
[Soutenir le développement sur Ko-fi](https://ko-fi.com/mashaup)

> [!WARNING]
> **Projet non officiel, à utiliser à vos risques.** Il n'est ni affilié ni approuvé par Vinted,
> et automatiser des actions sur le site peut ne pas être autorisé par les conditions de Vinted,
> qui peut restreindre ou suspendre les comptes. **L'auteur n'est pas responsable** de ce qui
> arrive à votre compte, des annonces perdues ou supprimées, des ventes manquées, ni des abus ou
> usages abusifs de l'extension. Republier **supprime** l'ancienne annonce : les vues et les favoris
> repartent de zéro. En l'installant, vous acceptez l'[avertissement complet](DISCLAIMER.md#français).

---

## Pour qui

Pour celles et ceux qui vendent depuis leur dressing Vinted et republient souvent les mêmes
articles : livres, mangas, vêtements, lots. Au lieu de recopier photos et textes dans une nouvelle
annonce et de supprimer l'ancienne, appuyez sur **Republier** sur la carte de l'article, ou
sélectionnez-en plusieurs et mettez-les dans une **file** avec une pause entre chacun.

C'est un projet personnel, gratuit et sans serveur : tout reste dans votre navigateur. L'interface
est disponible en **italien, anglais, français, espagnol et allemand**.

Elle est distribuée en zip sur GitHub et se charge comme extension non empaquetée — **elle n'est
pas sur le Chrome Web Store**. **Essayez-la d'abord sur un article peu important.**

## Installation

1. Téléchargez **`Vinted_Relist-2.6.1.zip`** depuis la
   [page des versions sur GitHub](https://github.com/MashaUP/Vinted_Relist/releases) (rubrique
   « Assets ») ou depuis la racine du dépôt.
2. Extrayez-le **dans un dossier permanent**, par ex. `Documents\Vinted_Relist` (pas dans le
   dossier temporaire que Windows ouvre en double-cliquant sur le zip). Le bon dossier est celui
   qui contient `manifest.json`.
3. Ouvrez `brave://extensions` (ou `chrome://extensions`) et activez le **Mode développeur** (en
   haut à droite).
4. **Charger l'extension non empaquetée** › choisissez le dossier qui contient `manifest.json`.
5. Ouvrez votre dressing sur Vinted **en étant connecté** et rechargez la page : les boutons
   **Republier** et **Modifier** apparaissent sur les cartes.

> Ne supprimez pas et ne déplacez pas le dossier après l'installation : le navigateur l'utilise à
> chaque fois.

### Mettre à jour

1. Popup › **Santé** › **Rechercher une mise à jour** (elle vérifie aussi toute seule toutes les
   12 heures et vous prévient).
2. **Téléchargez le zip** et extrayez-le **par-dessus le dossier actuel**, en remplaçant les
   fichiers.
3. **Installer la mise à jour** : l'extension se recharge. Rechargez ensuite les onglets Vinted (F5).

## Guide rapide

**0. Langue.** Le bouton 🌐 en haut du popup et du tableau de bord ouvre le panneau **Langue** :
« Automatique » suit la langue du navigateur, ou choisissez Italiano, English, Français, Español ou
Deutsch. Le changement s'applique partout immédiatement.

**1. Un article.** Sur une carte de votre dressing :
- **Republier** : clone l'annonce et supprime l'ancienne, tout de suite ;
- **Modifier** : changez d'abord photos, titre, description ou prix, voyez l'aperçu des
  modifications, puis publiez.

**2. Plusieurs articles (file).** Cochez les cases sur les cartes (Maj+clic pour une plage) ›
**File** › choisissez les options (prix, textes, intervalle entre les articles, heure de départ) ›
le contrôle lit chaque article **sans rien publier** et les classe en prêts, avec avertissements et
bloqués › **Lancer**. Gardez un onglet Vinted ouvert pendant que la file travaille.

**3. Pendant que la file tourne.** Continuez à sélectionner des articles et appuyez sur **Ajouter
à la file** : le **Centre de modification** s'ouvre et ils deviennent un nouveau **lot** avec ses
propres règles et son intervalle. La file ne s'arrête pas. **Gérer** ouvre la page de la file, où
vous pouvez tout voir, réorganiser, mettre en pause et corriger.

**4. Annonces déjà supprimées par Vinted.** Avec [Vintory](https://github.com/MashaUP/Vintory),
exportez les annonces (« Pour Vinted_Relist »), puis Tableau de bord › **Republier depuis
Vintory** › choisissez le ZIP : l'aperçu indique celles qui peuvent être republiées, sans rien
supprimer.

**5. En cas de problème.** Popup › **Santé** : état de l'extension, diagnostic à copier et que
faire. Un résultat incertain devient « à vérifier » et n'est jamais republié automatiquement.

## Ce qu'elle fait

- **Republication :** clone l'annonce (photos, titre, description, catégorie, marque, taille, état,
  couleurs, modèle pour les téléphones, prix, livraison) et supprime l'ancienne, avec les API
  internes du site et votre session — aucun clic simulé.
- **Ordre sûr :** publier d'abord, puis supprimer (par défaut). Si Vinted refuse la nouvelle
  annonce, l'ancienne reste.
- **Dans le doute, elle ne republie pas :** sans réponse claire de Vinted, l'article devient « à
  vérifier » et c'est vous qui confirmez (aussi avec **Vérifier la publication**, qui regarde sur
  Vinted sans rien publier).
- **Uniquement vos annonces :** les boutons n'apparaissent que dans votre dressing ; les articles
  vendus ne sont jamais republiés.
- **Éditeur d'annonce :** réorganiser, pivoter, recadrer et retirer des photos ; titre,
  description, prix, couleur ; contrôles en temps réel et score de complétude ; téléchargement des
  photos d'origine.
- **File :** ajouter, retirer et réorganiser même pendant qu'elle tourne ; lots avec leurs propres
  règles et intervalle ; marqueurs d'état sur les cartes ; pause minutée ; « Republier
  maintenant » ; options groupées (prix en %, en euros ou fixe, rechercher-remplacer, ligne en fin
  de description) ; protections contre les limites de Vinted ; historique et export CSV/JSON.
- **Tableau de bord :** gestion de la file, groupes d'articles (récents, stagnants, à optimiser…),
  doublons possibles, ce qui marche (vues à 48 h par jour et par plage horaire), historique avec
  comparaison avant/après et restauration, **Republier depuis Vintory**.

## Conseils : quand republier

- **Entre deux articles différents, 15 à 20 minutes** (l'intervalle par défaut de la file). Peu
  d'articles à la fois, des pauses généreuses.
- **Le même article tous les 5 à 7 jours, jamais tous les jours.**
- **Le dimanche soir, 20 h–22 h** semble le meilleur moment ; le **vendredi** le pire jour ; évitez
  1 h–6 h.

Ces chiffres viennent de vendeurs d'outils de republication ([Relisted](https://relisted.io/en/blog/best-time-post-vinted),
[Vinkit](https://vinkit.co/it/blog/con-quale-frequenza-ripubblicare-annunci-vinted-studio-24m-articoli))
et ne sont pas vérifiables ; au bout de quelques semaines, le tableau de bord montre ce qui marche
pour votre dressing.

## En cas de problème

Popup › **Santé** › **Préparer le diagnostic** : version, réglages, état de la file et erreurs
récentes, sans jetons, cookies, identifiants ni adresses. Vous le voyez avant de le copier, et vous
pouvez le coller sur Discord ou dans un signalement.

- **Les boutons n'apparaissent pas.** Ils n'apparaissent que dans votre dressing
  (`/member/<votre id>`) une fois votre compte reconnu : naviguez un peu sur Vinted en étant
  connecté, puis rechargez.
- **« Jeton CSRF introuvable » ou « rechargez cette page » après une mise à jour.** Rechargez
  l'onglet Vinted (F5) : les pages déjà ouvertes gardent l'ancien code.
- **Téléphones : Vinted demande de sélectionner le modèle.** Depuis la 2.6, le modèle est repris
  automatiquement. Si cela arrive encore : ouvrez l'annonce sur Vinted › **Modifier** › vérifiez
  le modèle › enregistrez, puis réessayez (l'extension apprend les champs de cette catégorie). Si
  cela ne suffit pas, envoyez-nous le diagnostic.
- **La file s'arrête avec « Problème de l'extension ».** La raison est indiquée dans la pause et
  dans le diagnostic. Recharger l'onglet Vinted suffit généralement ; puis **Reprendre**. Rien
  n'avait été envoyé à Vinted.
- **Erreur 403 ou 429.** C'est la protection anti-bot de Vinted : la file ralentit d'elle-même.
  Augmentez l'intervalle.
- **Icône cassée, `ERR_FILE_NOT_FOUND`.** Le navigateur ne trouve plus le dossier : extrayez-le dans
  un emplacement permanent et rechargez l'extension depuis là.

## Confidentialité et autorisations

Brouillons, historique, statistiques, file et notifications restent dans votre navigateur.
**Aucune télémétrie, aucun serveur, aucune donnée envoyée à l'auteur.** Les seules requêtes hors de
Vinted vont vers GitHub, sans cookies ni données personnelles : `version.json` pour les mises à
jour et `links.json` pour les liens du projet (désactivable dans Réglages › Avancé).

| Autorisation | Pourquoi |
|---|---|
| `storage` | réglages, file, inventaire, historique, notifications, langue : tout en local |
| `webRequest` | lire le jeton de session, votre identifiant et les formats dans les requêtes de Vinted |
| `alarms` | réveiller la file au bon moment et reprendre une pause minutée |
| `notifications` | notifications de fin de file et de mise à jour |
| `idle` | rythme irrégulier : aucune action quand vous n'êtes pas devant l'ordinateur |
| `downloads` | photos téléchargées, sauvegardes des réglages, exports de la file |
| sites `vinted.*` et `*.vinted.net` | appeler les API de Vinted et télécharger les photos de son CDN |

## Ce qu'elle ne fait pas

- Elle ne fait pas revivre l'annonce d'origine : vues, favoris et ancienneté repartent de zéro.
- Elle ne modifie pas les photos pour échapper aux contrôles de Vinted.
- Elle ne fonctionne pas navigateur fermé : il faut le navigateur ouvert et un onglet Vinted.
- Elle ne se met pas à jour toute seule : elle vous prévient, vous extrayez le zip.

## Aide et soutien

- **Questions et aide :** la [communauté Discord](https://discord.gg/EPsbQCuAkx).
- **Bugs :** [ouvrez un signalement](https://github.com/MashaUP/Vinted_Relist/issues/new?template=segnalazione-bug.yml)
  avec la version, le navigateur, ce qui s'est passé et le diagnostic. **Ne collez jamais de
  cookies, de jetons ni de données de compte.**
- **Soutenir le développement :** Vinted Relist est gratuit ; s'il vous fait gagner du temps, vous
  pouvez m'offrir un café sur [Ko-fi](https://ko-fi.com/mashaup).

La documentation technique pour les développeurs est en italien ([README](README.md#per-sviluppatori),
[docs/SVILUPPO.md](docs/SVILUPPO.md)).

## Licence et avertissement

[MIT](LICENSE) : vous pouvez utiliser, modifier et redistribuer le code, y compris dans vos propres
projets, à condition de conserver la mention de copyright. Le logiciel est fourni **tel quel, sans
garantie**.

Vinted Relist est un projet indépendant, **ni affilié ni approuvé par Vinted**. Utilisation à vos
risques : l'auteur n'est pas responsable des suspensions ou blocages de compte, des annonces
perdues, des ventes manquées, ni des abus ou usages abusifs. Lisez l'[avertissement complet](DISCLAIMER.md#français).
