# Original source preservation

The original website was archived **before modifying the application**, on October 10, 2026:

- `legacy_reference/Original_SAT_Tracker.archived.txt`: exact original `index.html`.
- `legacy_reference/Original_Mathlive_Module.archived.txt`: previously disabled historical notes module.
- `legacy_reference/README.md`: archive purpose and usage.

Original HTML SHA-256: `7bca2692a234096e6a49d40aae6da9afb0ee7bfae086ab92f77679d46e3be42d`.
Original executable SAT script SHA-256: `d125050f02f69a9c3c5d4f542eadf92b71539c550eec925630139354330879ca`.

The `.txt` archives cannot launch as another application. No active HTML/JS imports or references them. They are ignored by Git and reside outside `dist/`. The production build copies only its public allowlist, and the Pages workflow uploads only `dist/`. They remain readable in the VS Code folder explorer and must not be deleted or force-added to the public repository.

The new active site is `index.html` plus `assets/`. The active SAT section uses `sat.html`: its original script is copied intact with a small appended same-origin bridge. It retains Math/R&W taxonomy and slots, IDs, question status/attempts/notes, filtering/search, editing/autosave, Save-and-next, bulk import, exports/restore, timer, existing local keys, and original OAuth/Drive sync. The archive is reference material; the active tracker runs from its own file.

Open this repository in VS Code, expand `legacy_reference`, and compare the original implementation when maintaining the tracker. Configure VS Code to display ignored files if your personal explorer settings hide them. `3cn7.github.io.code-workspace` opens this repository folder directly.
