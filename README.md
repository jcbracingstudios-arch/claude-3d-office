# Claude 3D Office

Un bureau virtuel 3D qui montre en direct ce que font tes sessions Claude Code.
Chaque session est une mascotte « boss » à son bureau ; ses sous-agents sont des petits « employés » à côté.

- **100 % local** : rien ne sort de ta machine. Le serveur n'écoute que `127.0.0.1` et demande un jeton.
- **Zéro token** : les hooks sont de simples commandes locales, muettes. Claude ne voit rien, aucun modèle n'est appelé.
- **Aucune dépendance à l'exécution** : collecteur et daemon en Node pur.

## Installer l'app (Windows)

1. Lance `Claude 3D Office_0.1.0_x64-setup.exe` (pas besoin de droits admin ; Windows peut afficher « Éditeur inconnu » tant que l'app n'est pas signée : « Informations complémentaires » → « Exécuter quand même »).
2. Au premier lancement, clique **Connecter** : l'app ajoute ses hooks à `~/.claude/settings.json` (sauvegarde faite avant).
3. Fermer la fenêtre garde l'app dans la zone près de l'horloge ; clic sur l'icône pour la rouvrir, clic droit → Quitter.
4. Pour arrêter : bouton **Déconnecter** dans la barre du haut, puis désinstalle l'app depuis les Paramètres Windows.

Aucun pré-requis : ni Node, ni navigateur. L'exe sert aussi de collecteur (`claude-3d-office.exe --hook`).

Construire l'app : installer Rust + Visual Studio Build Tools (C++), puis `npm install` et `npm run app:build`. L'installateur sort dans `src-tauri/target/release/bundle/nsis/`.

## Utilisation sans l'app (Node)

```bash
npx claude-3d-office install     # ajoute les hooks (sauvegarde horodatée de settings.json avant)
npx claude-3d-office             # lance le bureau et l'ouvre dans le navigateur
npx claude-3d-office tail 20     # 20 derniers événements
npx claude-3d-office demo        # scénario de démonstration (60 s)
npx claude-3d-office uninstall   # retire uniquement les hooks de ce projet
```

Depuis ce dossier (avant publication sur npm) : remplace `npx claude-3d-office` par `node bin/cli.js`.

Lire le journal en PowerShell :

```powershell
Get-Content "$env:USERPROFILE\claude-office\events.jsonl" -Tail 20
```

## Le décor

Un open space aux baies vitrées, posé comme une maquette sur un îlot de pelouse (arbres, buissons, allée éclairée jusqu'à la terrasse). Les mascottes passent par les portes et contournent les meubles : elles ne traversent jamais les vitres.

- **Îlots d'équipe** : chaque session a son îlot. Le boss est au grand bureau, ses sous-agents (employés) sur les petits bureaux de chaque côté. Les bureaux d'employés apparaissent quand des sous-agents démarrent.
- **Salle de réunion vitrée** : les sessions qui attendent ta validation viennent s'y asseoir, main levée.
- **Pause** : bar et cuisine, salon, tables hautes, bibliothèque, terrasse avec transats et parasols.
- **Salle serveurs** : baies aux LED clignotantes (décor).
- **Jour et nuit** : le ciel, le soleil et les lumières suivent l'heure de ton PC ; la nuit, les lampes du bureau et de l'allée s'allument. Pour prévisualiser une heure : ajoute `?hour=21` à l'adresse.

## Ce que montre le bureau

| État | Mascotte |
|---|---|
| Aucune tâche | dans l'espace pause (café, canapé, bibliothèque, table) |
| Tâche en cours | à son bureau, tape au clavier, écran vert et lignes de code |
| Attend ta validation | va en salle de réunion, « ! » orange, main levée + notification système |
| Erreur | « ! » rouge + notification système |
| Tâche finie | saute de joie « ✓ », puis retourne en pause |

Clic sur une mascotte : HUD avec dossier, branche Git, dernière action, durée, employés actifs et logs en direct.

## Fonctionnement

1. `collector/hook.js` : appelé par Claude Code (hooks `async`, forme exec, sans shell). Lit l'événement sur stdin, ajoute une ligne à `%USERPROFILE%\claude-office\events.jsonl`, sort toujours avec le code 0 sans rien afficher. Ne garde ni prompt, ni contenu de fichier, ni sortie d'outil ; le petit résumé gardé (commande, chemin) est filtré des secrets puis tronqué.
2. `daemon/` : suit le fichier, calcule l'état de chaque session, le pousse au navigateur en SSE.
3. `ui/` : React + React Three Fiber. Modèles low-poly faits dans Blender (`ui/public/models/*.glb`).

Hooks utilisés : `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `SessionEnd`.

## Développement

```bash
npm install
npm test          # tests du collecteur, de l'installation et du daemon
npm run build     # construit ui/dist
npm run dev       # UI avec rechargement (le daemon doit tourner)
```
