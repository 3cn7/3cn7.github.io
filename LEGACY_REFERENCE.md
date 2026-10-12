# Historical source archive

The original source remains locally readable in VS Code and is excluded from runtime and deployment.

- `legacy_reference/Original_SAT_Tracker.archived.txt`: exact original website HTML.
- `legacy_reference/Original_Mathlive_Module.archived.txt`: original disabled notes module.
- `legacy_reference/pre_redesign/Study_Tracker.archived.txt`: the previous active tracker at the refactor checkpoint.
- `legacy_reference/pre_redesign/Transcription_Client.archived.txt`: previous cloud/client transcription module.
- `legacy_reference/pre_redesign/Transcription_Interface.archived.txt`: previous transcript interface.
- `legacy_reference/pre_redesign/Companion_Server.archived.txt`: previous inference server.

Original HTML SHA-256: `7bca2692a234096e6a49d40aae6da9afb0ee7bfae086ab92f77679d46e3be42d`.

The original reference archive predates this refactor. The pre-redesign Git checkpoint is `99f69a0d805327b894bf01b04edf58f0d5222660`. All archived copies use `.txt` extensions; active code never imports or fetches them. `legacy_reference/` is ignored by Git and omitted by the production build. The older tracked `archive/mathlive-notes-module.js.disabled` also remains excluded from the public artifact.

Open `3cn7.github.io.code-workspace` in VS Code and expand `legacy_reference`. These files are historical reference material. The active application consists of `index.html`, `assets/`, `sw.js` and the build's local vendor runtime. There is no active tracker iframe, tracker route or inference server.
