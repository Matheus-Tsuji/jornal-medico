"""Servidor HTTP minimo (stdlib) para o ranking. Uso: python serve.py --port 8790"""
import argparse
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from rank import MODEL_VERSION, rank

MAX_BODY = 1_000_000
# Token compartilhado com o servidor (RECOMMENDER_TOKEN). Sem ele, escute so em 127.0.0.1.
TOKEN = os.environ.get("RECOMMENDER_TOKEN", "")


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            return self._send(200, {"status": "ok", "model_version": MODEL_VERSION})
        return self._send(404, {"error": "not_found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/rank":
            return self._send(404, {"error": "not_found"})
        if TOKEN and not hmac.compare_digest(self.headers.get("authorization", ""), f"Bearer {TOKEN}"):
            return self._send(401, {"error": "unauthorized"})
        try:
            n = int(self.headers.get("content-length", 0))
        except (TypeError, ValueError):
            return self._send(400, {"error": "invalid_content_length"})
        if n <= 0:
            return self._send(400, {"error": "empty_body"})
        if n > MAX_BODY:
            return self._send(413, {"error": "body_too_large"})
        try:
            req = json.loads(self.rfile.read(n))
            out = rank(req["candidates"], req["profile"], int(req.get("k", 6)))
        except (KeyError, TypeError, ValueError, AttributeError) as e:
            return self._send(400, {"error": f"invalid_input: {type(e).__name__}"})
        return self._send(200, {"ranked": out, "model_version": MODEL_VERSION})

    def log_message(self, *_):  # silencia log padrao
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    print(json.dumps({"event": "recommender_started", "port": a.port, "model_version": MODEL_VERSION}), flush=True)
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()
