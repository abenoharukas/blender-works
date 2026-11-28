"""Serve the repository for export_web_scene.html and save its POSTed GLB."""

import http.server
import os
import shutil
import socketserver
import urllib.parse

ROOT = "/Users/raku/repos/blender-works"
OUT = os.path.join(ROOT, "streets/native/out")
THREERT_ASSETS = "/Users/raku/repos/others/threert-assets"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        data = self.rfile.read(length)
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if self.path.startswith("/__save_chunk"):
            name = qs.get("name", ["export.glb"])[0]
            part = int(qs.get("part", ["0"])[0])
            done = qs.get("done", ["0"])[0] == "1"
            base = os.path.basename(name)
            path = os.path.join(OUT, base)
            tmp = path + ".part"
            mode = "wb" if part == 0 else "ab"
            with open(tmp, mode) as fh:
                fh.write(data)
            if done:
                os.replace(tmp, path)
                size = os.path.getsize(path)
                print(f"saved {path} ({size} bytes)", flush=True)
                if os.path.isdir(THREERT_ASSETS):
                    dst = os.path.join(THREERT_ASSETS, base)
                    shutil.copy2(path, dst)
                    print(f"synced {dst}", flush=True)
                base_blend = os.path.join(OUT, "cycles-street-base.blend")
                if os.path.exists(base_blend):
                    os.remove(base_blend)
                    print(f"invalidated {base_blend}", flush=True)
        elif self.path.startswith("/__save"):
            name = qs.get("name", ["export.glb"])[0]
            base = os.path.basename(name)
            path = os.path.join(OUT, base)
            with open(path, "wb") as fh:
                fh.write(data)
            print(f"saved {path} ({len(data)} bytes)", flush=True)
            if os.path.isdir(THREERT_ASSETS):
                dst = os.path.join(THREERT_ASSETS, base)
                shutil.copy2(path, dst)
                print(f"synced {dst}", flush=True)
            base_blend = os.path.join(OUT, "cycles-street-base.blend")
            if os.path.exists(base_blend):
                os.remove(base_blend)
                print(f"invalidated {base_blend}", flush=True)
        else:
            print(f"log: {data.decode(errors='replace')}", flush=True)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", 8765), Handler) as httpd:
    print("serving on 8765", flush=True)
    httpd.serve_forever()
