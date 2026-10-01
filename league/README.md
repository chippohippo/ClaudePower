# League WASD setup, Marvel Rivals-style

| Action | League default | This setup | Rivals equivalent |
|---|---|---|---|
| Move | WASD (WASD mode) | W A S D | W A S D |
| Basic attack | Right-click | **Left mouse** | Primary fire |
| Q ability | Q | **Right mouse** | Secondary fire |
| W ability | W | **Shift** | Ability 1 |
| E ability | E | **E** | Ability 2 |
| R ultimate | R | **Q** | Ultimate |
| Summoner 1 (Flash) | D | **Space** | Jump / mobility |
| Summoner 2 | F | **C** | — |
| Trinket / ward | 4 | **F** | Ability 3 |
| Items 1–6 | 1–3, 5–7 | 1 2 3 Z X V | — |
| Level up ability | Ctrl+Q/W/E/R | Ctrl + new key | — |
| Recall / Shop / Score | B / P / Tab | unchanged | — |
| Select / center on self | F1 | **G** (60%-friendly) | — |

## Install
1. In the client, turn on WASD mode (Settings → Hotkeys).
2. Close League. Back up `C:\Riot Games\League of Legends\Config\input.ini`.
3. Copy the `[GameEvents]` lines from `input.ini` here into that file (or replace it).
4. Launch the game and check the Hotkeys menu. If a bind didn't apply, set it there by hand using the table.

Note: Riot's `input.ini` key names for WASD mode can change between patches. If the game resets a bind, the table is the source of truth.

## Setting binds in game (recommended)
The client keeps its own copy of hotkeys and overwrites `input.ini` when it starts, so edits to that file often get wiped. Set them in game instead:
1. Esc → Settings → Hotkeys. Enable WASD movement.
2. Click a slot, press the new key, and repeat for each row of the table above. Mouse buttons can be bound by clicking the slot then clicking the mouse button.
3. Clear the old bind if the game warns about a conflict (e.g. Q, Space, F).
4. Hit OK. The binds now save to your account and follow you to other PCs.
