# seek — inspiration canvas

An avant‑garde, infinitely growing canvas of images sourced from the public index at `http://52.33.176.184/tmdbbd/`.

## Run locally (Windows PowerShell)

```powershell
# from the project root
python -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\python -m pip install -r requirements.txt

# start server (supports host/port flags)
.\.venv\Scripts\python .\main.py --host 127.0.0.1 --port 9000 --reload
```

Then open `http://127.0.0.1:9000`.

## Notes

- The backend caches the remote directory listing for 1 hour to be polite.
- Images are proxied via `/proxy?url=...` to avoid CORS/hotlink issues.
- The front‑end randomly places, rotates, and scales images across a huge plane, and expands the plane as you explore for a sense of endless discovery.
- Source: [tmdbbd archive](http://52.33.176.184/tmdbbd/)
