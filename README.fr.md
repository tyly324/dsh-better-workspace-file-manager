# Gestionnaire de fichiers d’espace de travail (amélioré)

[English](README.md) · [简体中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md) · **Français** · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

> **Note de fork (tyly324)** : ce dépôt est un fork de [Arrosam/dsh-better-workspace-file-manager](https://github.com/Arrosam/dsh-better-workspace-file-manager). Il ajoute la confirmation de la destination d’envoi, la progression et la nouvelle tentative, la fermeture automatique du dialogue de suppression, ainsi que couper/copier/coller, renommer, compresser/extraire des ZIP, les propriétés et nouveau dossier. Même licence MIT que l’original.

Un gestionnaire de fichiers pour l’onglet **Fichiers** de DSH Web et le panneau d’aperçu. Il ajoute les opérations d’écriture manquantes à l’arborescence officielle sans modifier son DOM.

## Fonctionnalités

- **Envoi** par bouton, glisser-déposer depuis l’ordinateur ou dépôt d’un dossier. L’emplacement cible (dossier sélectionné, sinon racine de l’espace de travail) est confirmé avant l’ouverture du sélecteur, puis une progression par fichier, le motif d’échec et **Réessayer** sont affichés.
- **Sélection multiple** par clic, ⌘/Ctrl+clic, Maj+clic ou rectangle de sélection sur l’espace vide.
- **Téléchargement** d’un fichier, d’une sélection ou d’un dossier entier en ZIP, en flux.
- **Nouveau dossier** depuis le menu contextuel ou le bouton d’en-tête ; création dans le dernier dossier sélectionné, sinon à la racine.
- **Suppression** après confirmation. Le dialogue se ferme toujours à la fin ; si la ligne n’existe plus, il se ferme et la liste est actualisée.
- **Couper / copier / coller / renommer** : en cas de conflit, `name (1).ext`, jamais d’écrasement.
- **Compression / extraction ZIP** : les entrées `..`, les chemins absolus, les liens symboliques et les archives chiffrées sont refusés avant écriture.
- **Propriétés** : nom, type, taille (nombre d’éléments pour un dossier), date de modification, permissions et chemin absolu.
- **Déplacement par glisser-déposer / vers la conversation** : déposer sur un dossier déplace ; déposer dans la zone de saisie ajoute une référence `@path`.
- **Aperçu** : téléchargement depuis chaque aperçu ; édition sur place du texte/code/Markdown en conservant les fins de ligne et le BOM, avec détection de conflit et enregistrement manuel ou automatique toutes les 5 s.

## Installation

```sh
dsh plugin --profile web add github:tyly324/dsh-better-workspace-file-manager
```

Prérequis : profil **Web** de DSH **0.2.1-rc.3 ou supérieur** (testé avec 0.2.2-rc.1), système de fichiers local de l’hôte (fs-local / fs-sandbox) et Node.js 20.15+.

## Remarques et limites

- **ZIP** standard uniquement ; ZIP64, ZIP chiffré, 7z et rar ne sont pas pris en charge.
- 2 Gio par fichier/archive et 10 000 entrées au maximum ; pour les gros travaux, utilisez le terminal.
- La suppression est **définitive**, sans corbeille.
- Le presse-papiers de fichiers ne vit que dans la page courante et se vide au rechargement.
- La taille d’un dossier indique le nombre d’éléments directs, pas le total récursif.

## Licence

MIT, basé sur Arrosam/dsh-better-workspace-file-manager. La documentation complète en anglais se trouve dans [README.md](README.md).
