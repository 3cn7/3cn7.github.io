"""Serve only the production artifact. Private archives and companion files stay private."""
import http.server
from pathlib import Path
from functools import partial
root = Path(__file__).resolve().parent.parent / 'dist'
if not (root / 'index.html').exists():
    raise SystemExit('Run npm run build first (or node scripts/build.mjs).')
print('Preview: http://127.0.0.1:8765', flush=True)
handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
http.server.ThreadingHTTPServer(('127.0.0.1', 8765), handler).serve_forever()
