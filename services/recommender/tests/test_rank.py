import json
import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evaluate import main as evaluate  # noqa: E402
from rank import ndcg_at_k, precision_at_k, rank  # noqa: E402
from serve import Handler  # noqa: E402


def cand(i, topic, **kw):
    c = {"id": i, "topics": [topic, "cardiologia", "clinica-medica"], "primaryTopic": topic, "source": "pubmed",
         "ageDays": 1, "priority": 0.5, "read": False}
    c.update(kw)
    return c


POOL = [cand("h1", "hipertensao-arterial", priority=0.9), cand("h2", "hipertensao-arterial"), cand("h3", "hipertensao-arterial"),
        cand("d1", "diabetes", topics=["diabetes", "endocrinologia", "clinica-medica"]), cand("i1", "insuficiencia-cardiaca", ageDays=20)]
EMPTY = {"topics": [], "sources": [], "lessTopics": [], "personalization": True}


def test_cold_start_general_selection():
    r = rank(POOL, EMPTY, 3)
    assert r[0]["id"] == "h1"
    assert "Seleção geral" in r[0]["reasons"]


def test_preference_and_opt_out():
    assert rank(POOL, {**EMPTY, "topics": ["diabetes"]}, 3)[0]["id"] == "d1"
    assert rank(POOL, {**EMPTY, "topics": ["diabetes"], "personalization": False}, 3)[0]["id"] == "h1"


def test_diversity_cap_and_outsider():
    r = rank(POOL, {**EMPTY, "topics": ["hipertensao-arterial"]}, 3)
    assert sum(x["id"].startswith("h") for x in r) <= 2
    assert any(not x["id"].startswith("h") for x in r)


def test_less_of_topic():
    assert not rank(POOL, {**EMPTY, "lessTopics": ["hipertensao-arterial"]}, 5)[0]["id"].startswith("h")


def test_metrics():
    assert precision_at_k(["a", "b"], {"a"}, 2) == 0.5
    assert ndcg_at_k(["a", "b"], {"a"}, 2) == 1.0
    assert ndcg_at_k(["b", "a"], {"a"}, 2) < 1.0


def test_offline_evaluation_runs_on_synthetic_data():
    res = evaluate()
    assert res["data"] == "synthetic"
    assert res["model"]["precision@k"] >= res["recency_baseline"]["precision@k"]
    assert res["cold_start_items"] > 0


def test_http_contract():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_port}"
    try:
        body = json.dumps({"candidates": POOL, "profile": EMPTY, "k": 2}).encode()
        req = urllib.request.Request(f"{base}/rank", data=body, headers={"content-type": "application/json"})
        out = json.loads(urllib.request.urlopen(req, timeout=5).read())
        assert out["model_version"] == "content-tfidf-v1"
        assert len(out["ranked"]) == 2
        bad = urllib.request.Request(f"{base}/rank", data=b'{"x":1}', headers={"content-type": "application/json"})
        try:
            urllib.request.urlopen(bad, timeout=5)
            raise AssertionError("esperava 400")
        except urllib.error.HTTPError as e:
            assert e.code == 400
    finally:
        srv.shutdown()


def test_parity_with_typescript_reasons_and_matched_topics():
    case = json.loads((Path(__file__).parent / "parity_case.json").read_text(encoding="utf-8"))
    out = rank(case["candidates"], case["profile"], len(case["candidates"]))
    got = {x["id"]: {"reasons": x["reasons"], "matchedTopics": x["matchedTopics"]} for x in out}
    assert got == case["expected"]


def test_source_reason_parity():
    r = rank(POOL, {**EMPTY, "sources": ["pubmed"]}, 2)
    assert all("Fonte que você segue" in x["reasons"] for x in r)


def _raw_post(port, headers, body=b""):
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.putrequest("POST", "/rank")
    for k, v in headers.items():
        conn.putheader(k, v)
    conn.endheaders()
    if body:
        conn.send(body)
    status = conn.getresponse().status
    conn.close()
    return status


def test_http_rejects_bad_input():
    import serve
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_port
    try:
        assert _raw_post(port, {"content-length": "abc"}) == 400
        assert _raw_post(port, {"content-length": str(serve.MAX_BODY + 1)}) == 413
        bad_profile = json.dumps({"candidates": POOL, "profile": [], "k": 2}).encode()
        assert _raw_post(port, {"content-length": str(len(bad_profile))}, bad_profile) == 400
        serve.TOKEN = "segredo-de-teste"
        ok = json.dumps({"candidates": POOL, "profile": EMPTY, "k": 2}).encode()
        assert _raw_post(port, {"content-length": str(len(ok))}, ok) == 401
        assert _raw_post(port, {"content-length": str(len(ok)), "authorization": "Bearer segredo-de-teste"}, ok) == 200
    finally:
        serve.TOKEN = ""
        srv.shutdown()
