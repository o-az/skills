# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets==15.0.1"]
# ///

"""
Screencast Relay Server

Connects to Chrome via CDP, subscribes to Page.screencastFrame events,
and relays JPEG frames to all connected viewers over WebSocket.

Usage:
  uv run scripts/server.py
  uv run scripts/server.py --cdp-url ws://127.0.0.1:9222/...
  CDP_URL=ws://... uv run scripts/server.py

Env:
  BIND_HOST      - HTTP/WS bind host (default: 127.0.0.1)
  CDP_URL        - Chrome DevTools Protocol WebSocket URL
  PORT           - HTTP/WS port (default: 3456)
  QUALITY        - JPEG quality 1-100 (default: 40)
  MAX_WIDTH      - Max frame width (default: 960)
  MAX_HEIGHT     - Max frame height (default: 540)
  EVERY_NTH      - Only send every Nth frame (default: 1)
  IDLE_TIMEOUT   - Auto-shutdown after N seconds of inactivity (default: 1800, 0 = disabled)

Requirements:
  uv run installs the inline dependencies declared above
"""

import os
import sys
import json
import signal
import base64
import asyncio
import argparse
import subprocess
from http import HTTPStatus
from urllib.parse import urlparse
from urllib.request import urlopen

import websockets
from websockets.http11 import Response

BIND_HOST = os.environ.get("BIND_HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "3456"))
QUALITY = int(os.environ.get("QUALITY", "40"))
MAX_WIDTH = int(os.environ.get("MAX_WIDTH", "960"))
MAX_HEIGHT = int(os.environ.get("MAX_HEIGHT", "540"))
EVERY_NTH = int(os.environ.get("EVERY_NTH", "1"))
IDLE_TIMEOUT = int(os.environ.get("IDLE_TIMEOUT", "1800"))  # seconds, 0 = disabled

# --- CDP discovery ---


def discover_cdp_url() -> str:
    if len(sys.argv) > 1 and sys.argv[1].startswith("ws"):
        return sys.argv[1]
    if cdp_url := os.environ.get("CDP_URL"):
        return cdp_url

    # agent-browser CLI
    try:
        proc = subprocess.run(
            ["agent-browser", "get", "cdp-url"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        url = proc.stdout.strip().split("\n")[-1].strip()
        if url.startswith("ws"):
            return url
    except Exception as e:
        print(f"[relay] agent-browser discovery failed: {e}", file=sys.stderr, flush=True)

    # Common CDP ports
    for port in (9222, 9229):
        try:
            with urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2) as resp:
                data = json.loads(resp.read())
                if ws_url := data.get("webSocketDebuggerUrl"):
                    return ws_url
        except Exception:
            pass

    raise RuntimeError(
        "Cannot find CDP. Pass ws:// URL as arg, set CDP_URL, or start agent-browser."
    )


def get_page_target(browser_ws_url: str) -> str:
    parsed = urlparse(browser_ws_url)
    try:
        with urlopen(
            f"http://{parsed.hostname}:{parsed.port}/json/list", timeout=2
        ) as resp:
            targets = json.loads(resp.read())
            for t in targets:
                if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                    return t["webSocketDebuggerUrl"]
    except Exception as e:
        print(f"[relay] Failed to list page targets: {e}", file=sys.stderr, flush=True)
    return browser_ws_url


# --- CDP client ---


class CdpClient:
    def __init__(self, url: str):
        self._url = url
        self._next_id = 1
        self._ws = None
        self._handlers: dict[str, callable] = {}
        self._pending: dict[int, asyncio.Future] = {}
        self._listen_task = None

    async def connect(self):
        self._ws = await websockets.connect(self._url, max_size=None)
        self._listen_task = asyncio.create_task(self._listen())

    async def _listen(self):
        try:
            async for raw in self._ws:
                msg = json.loads(raw)
                if "id" in msg:
                    fut = self._pending.pop(msg["id"], None)
                    if fut and not fut.done():
                        if "error" in msg:
                            fut.set_exception(RuntimeError(msg["error"]["message"]))
                        else:
                            fut.set_result(msg.get("result"))
                elif "method" in msg:
                    handler = self._handlers.get(msg["method"])
                    if handler:
                        try:
                            result = handler(msg.get("params", {}))
                            if asyncio.iscoroutine(result):
                                await result
                        except Exception as e:
                            print(f"[relay] Event handler error: {e}", file=sys.stderr, flush=True)
        except websockets.ConnectionClosed:
            pass
        finally:
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(RuntimeError("CDP connection closed"))
            self._pending.clear()

    async def send(self, method: str, params: dict = None):
        msg_id = self._next_id
        self._next_id += 1
        fut = asyncio.get_running_loop().create_future()
        self._pending[msg_id] = fut
        await self._ws.send(
            json.dumps({"id": msg_id, "method": method, "params": params or {}})
        )
        return await fut

    def on(self, event: str, handler):
        self._handlers[event] = handler

    async def close(self):
        try:
            await self._ws.close()
        except Exception:
            pass
        if self._listen_task:
            self._listen_task.cancel()
            try:
                await self._listen_task
            except (asyncio.CancelledError, Exception):
                pass


# --- Viewer HTML ---

VIEWER_HTML = """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Live Screencast</title>
    <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0a; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: system-ui, -apple-system, sans-serif; color: #fff; }
    #frame { max-width: 100vw; max-height: 90vh; border: 1px solid #222; border-radius: 8px; background: #111; }
    #status { position: fixed; top: 12px; right: 16px; font-size: 13px; padding: 6px 12px; border-radius: 6px; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); z-index: 10; }
    #status.connected { color: #4ade80; }
    #status.disconnected { color: #f87171; }
    #status.connecting { color: #facc15; }
    #info { position: fixed; bottom: 12px; left: 16px; font-size: 12px; color: #666; }
    #waiting { color: #888; font-size: 18px; }
    </style>
</head>
<body>
    <div id="status" class="connecting">connecting\u2026</div>
    <img id="frame" style="display:none" />
    <div id="waiting">waiting for frames\u2026</div>
    <div id="info">
    <span id="fps">0 fps</span> \u00b7 <span id="viewers">1 viewer</span> \u00b7 <span id="resolution"></span>
    </div>
    <script>
    const frame = document.getElementById('frame');
    const status = document.getElementById('status');
    const waiting = document.getElementById('waiting');
    const fpsEl = document.getElementById('fps');
    const viewersEl = document.getElementById('viewers');
    const resEl = document.getElementById('resolution');

    let frameCount = 0;
    let lastFpsTime = Date.now();

    function connect() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(proto + '//' + location.host + '/ws');
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
            status.textContent = 'live';
            status.className = 'connected';
        };

        ws.onmessage = (e) => {
            if (typeof e.data === 'string') {
                const msg = JSON.parse(e.data);
                if (msg.type === 'viewers') {
                    viewersEl.textContent = msg.count + (msg.count === 1 ? ' viewer' : ' viewers');
                } else if (msg.type === 'meta') {
                    resEl.textContent = msg.width + '\\u00d7' + msg.height;
                }
                return;
            }
            const blob = new Blob([e.data], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            frame.onload = () => URL.revokeObjectURL(url);
            frame.src = url;
            frame.style.display = 'block';
            waiting.style.display = 'none';
            frameCount++;
        };

        ws.onclose = () => {
            status.textContent = 'disconnected \\u2013 reconnecting\\u2026';
            status.className = 'disconnected';
            setTimeout(connect, 1000);
        };

        ws.onerror = () => ws.close();
    }

    setInterval(() => {
        const now = Date.now();
        const elapsed = (now - lastFpsTime) / 1000;
        fpsEl.textContent = Math.round(frameCount / elapsed) + ' fps';
        frameCount = 0;
        lastFpsTime = now;
    }, 2000);

    connect();
    </script>
</body>
</html>"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Relay Chrome screencast frames to browser viewers over HTTP/WebSocket."
        )
    )
    parser.add_argument(
        "legacy_cdp_url",
        nargs="?",
        help="Legacy positional Chrome DevTools websocket URL.",
    )
    parser.add_argument(
        "--cdp-url",
        help="Explicit Chrome DevTools websocket URL. Overrides CDP_URL.",
    )
    parser.add_argument(
        "--bind-host",
        default=BIND_HOST,
        help="Bind host for HTTP/WS server. Default: %(default)s",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=PORT,
        help="HTTP/WS port for viewers. Default: %(default)s",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=QUALITY,
        help="JPEG quality 1-100. Default: %(default)s",
    )
    parser.add_argument(
        "--max-width",
        type=int,
        default=MAX_WIDTH,
        help="Maximum frame width. Default: %(default)s",
    )
    parser.add_argument(
        "--max-height",
        type=int,
        default=MAX_HEIGHT,
        help="Maximum frame height. Default: %(default)s",
    )
    parser.add_argument(
        "--every-nth",
        type=int,
        default=EVERY_NTH,
        help="Forward every Nth frame. Default: %(default)s",
    )
    parser.add_argument(
        "--idle-timeout",
        type=int,
        default=IDLE_TIMEOUT,
        help="Auto-shutdown after N seconds of inactivity. 0 = disabled. Default: %(default)s",
    )
    args = parser.parse_args()
    if args.quality < 1 or args.quality > 100:
        parser.error("--quality must be between 1 and 100")
    if args.port < 1 or args.port > 65535:
        parser.error("--port must be between 1 and 65535")
    if args.every_nth < 1:
        parser.error("--every-nth must be >= 1")
    if not args.bind_host:
        parser.error("--bind-host must not be empty")
    return args

VIEWER_HTML_BYTES = VIEWER_HTML.encode()

# --- Main ---


async def main():
    args = parse_args()

    global BIND_HOST, PORT, QUALITY, MAX_WIDTH, MAX_HEIGHT, EVERY_NTH, IDLE_TIMEOUT
    BIND_HOST = args.bind_host
    PORT = args.port
    QUALITY = args.quality
    MAX_WIDTH = args.max_width
    MAX_HEIGHT = args.max_height
    EVERY_NTH = args.every_nth
    IDLE_TIMEOUT = args.idle_timeout
    if args.cdp_url:
        os.environ["CDP_URL"] = args.cdp_url
    elif args.legacy_cdp_url:
        os.environ["CDP_URL"] = args.legacy_cdp_url

    cdp_browser_url = discover_cdp_url()
    print(f"[relay] CDP browser: {cdp_browser_url}", flush=True)

    cdp_page_url = get_page_target(cdp_browser_url)
    print(f"[relay] CDP page target: {cdp_page_url}", flush=True)

    cdp = CdpClient(cdp_page_url)
    await cdp.connect()

    viewers: set[websockets.ServerConnection] = set()
    frame_number = 0
    latest_frame: bytes | None = None
    latest_meta = {"width": 0, "height": 0}
    last_activity = asyncio.get_running_loop().time()

    async def broadcast_viewer_count():
        msg = json.dumps({"type": "viewers", "count": len(viewers)})
        websockets.broadcast(viewers, msg)

    def on_screencast_frame(params):
        nonlocal frame_number, latest_frame, latest_meta, last_activity
        last_activity = asyncio.get_running_loop().time()
        data = params["data"]
        metadata = params["metadata"]
        session_id = params["sessionId"]

        asyncio.create_task(
            cdp.send("Page.screencastFrameAck", {"sessionId": session_id})
        )

        frame_number += 1
        if EVERY_NTH > 1 and frame_number % EVERY_NTH != 0:
            return

        binary = base64.b64decode(data)
        latest_frame = binary
        latest_meta = {
            "width": metadata.get("deviceWidth", 0) or 0,
            "height": metadata.get("deviceHeight", 0) or 0,
        }

        websockets.broadcast(viewers, binary)

    cdp.on("Page.screencastFrame", on_screencast_frame)

    await cdp.send("Page.startScreencast", {
        "format": "jpeg",
        "quality": QUALITY,
        "maxWidth": MAX_WIDTH,
        "maxHeight": MAX_HEIGHT,
        "everyNthFrame": 1,
    })
    print(f"[relay] Screencast started (quality={QUALITY}, {MAX_WIDTH}x{MAX_HEIGHT})", flush=True)

    # --- WebSocket + HTTP server ---

    async def process_request(connection, request):
        if request.path == "/health":
            body = json.dumps({
                "status": "ok",
                "viewers": len(viewers),
                "frames": frame_number,
                "bind_host": BIND_HOST,
                "meta": latest_meta,
            }).encode()
            return Response(
                HTTPStatus.OK,
                "OK",
                websockets.Headers({"Content-Type": "application/json"}),
                body,
            )

        if request.path != "/ws":
            return Response(
                HTTPStatus.OK,
                "OK",
                websockets.Headers({"Content-Type": "text/html; charset=utf-8"}),
                VIEWER_HTML_BYTES,
            )

    async def handler(ws):
        nonlocal last_activity
        last_activity = asyncio.get_running_loop().time()
        viewers.add(ws)
        try:
            await ws.send(json.dumps({"type": "meta", **latest_meta}))
            if latest_frame is not None:
                await ws.send(latest_frame)
            await broadcast_viewer_count()
            print(f"[relay] Viewer connected ({len(viewers)} total)", flush=True)
            async for _ in ws:
                pass
        finally:
            viewers.discard(ws)
            await broadcast_viewer_count()
            print(f"[relay] Viewer disconnected ({len(viewers)} total)", flush=True)

    # --- File watcher: reload browser on demo file changes ---

    async def watch_files(directory: str, interval: float = 0.5):
        mtimes: dict[str, float] = {}
        while True:
            changed = False
            try:
                for root, dirs, files in os.walk(directory):
                    dirs[:] = [d for d in dirs if d not in {".git", "node_modules", "__pycache__", ".next"}]
                    for f in files:
                        path = os.path.join(root, f)
                        mtime = os.path.getmtime(path)
                        if path in mtimes and mtimes[path] != mtime:
                            changed = True
                            print(f"[relay] File changed: {path}", flush=True)
                        mtimes[path] = mtime
            except Exception as e:
                print(f"[relay] File watch error: {e}", file=sys.stderr, flush=True)
            if changed:
                try:
                    await cdp.send("Page.reload")
                except Exception as e:
                    print(f"[relay] Reload failed: {e}", file=sys.stderr, flush=True)
            await asyncio.sleep(interval)

    # Determine watch dir: WATCH env, or auto-detect from browser's file:// URL
    watch_dir = os.environ.get("WATCH")
    if not watch_dir:
        try:
            result = await cdp.send("Runtime.evaluate", {"expression": "location.href"})
            page_url = result.get("result", {}).get("value", "")
            if page_url.startswith("file://"):
                from urllib.parse import unquote
                file_path = unquote(page_url[7:])
                watch_dir = os.path.dirname(file_path)
        except Exception:
            pass

    watch_task = None
    if watch_dir and os.path.isdir(watch_dir):
        watch_task = asyncio.create_task(watch_files(watch_dir))
        print(f"[relay] Watching {watch_dir} for changes", flush=True)

    async with websockets.serve(
        handler, BIND_HOST, PORT, process_request=process_request
    ):
        if BIND_HOST in {"127.0.0.1", "localhost"}:
            viewer_host = "localhost"
        else:
            viewer_host = BIND_HOST
        print(f"[relay] Viewer page: http://localhost:{PORT}", flush=True)
        print(f"[relay] Health check: http://localhost:{PORT}/health", flush=True)
        print(f"[relay] Bound to {BIND_HOST}:{PORT} (viewer host hint: {viewer_host})", flush=True)

        shutdown_event = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, shutdown_event.set)

        async def idle_watchdog():
            while IDLE_TIMEOUT > 0:
                await asyncio.sleep(60)
                idle = loop.time() - last_activity
                if idle >= IDLE_TIMEOUT:
                    print(f"[relay] Idle for {int(idle)}s, shutting down", flush=True)
                    shutdown_event.set()
                    return

        idle_task = asyncio.create_task(idle_watchdog()) if IDLE_TIMEOUT > 0 else None

        await shutdown_event.wait()
        print("\n[relay] Shutting down...", flush=True)

        if idle_task:
            idle_task.cancel()

    if watch_task:
        watch_task.cancel()

    try:
        await cdp.send("Page.stopScreencast")
    except Exception:
        pass
    await cdp.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
