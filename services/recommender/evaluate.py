"""Avaliacao offline com FIXTURE SINTETICA (nao ha dados reais elegiveis).

Compara o ranking (com termo de conteudo) contra uma politica so de recencia.
Os numeros servem para testar o pipeline de avaliacao, NAO para declarar eficacia.
"""
import json
import random

from rank import MODEL_VERSION, diversity, ndcg_at_k, precision_at_k, rank

TOPICS = [("hipertensao-arterial", "cardiologia"), ("insuficiencia-cardiaca", "cardiologia"), ("diabetes", "endocrinologia")]


def synthetic(seed: int = 7):
    rnd = random.Random(seed)
    cands = []
    for i in range(30):
        t, sub = rnd.choice(TOPICS)
        cands.append({"id": f"s{i}", "topics": [t, sub, "clinica-medica"], "primaryTopic": t, "source": "pubmed",
                      "ageDays": rnd.uniform(0, 20), "priority": rnd.uniform(0, 1), "read": False})
    users = []
    for _ in range(20):
        t, _sub = rnd.choice(TOPICS)
        relevant = {c["id"] for c in cands if c["primaryTopic"] == t}
        users.append(({"topics": [t], "sources": [], "lessTopics": [], "personalization": True}, relevant))
    return cands, users


def main(k: int = 5) -> dict:
    cands, users = synthetic()
    topic_of = {c["id"]: c["primaryTopic"] for c in cands}
    recency = [c["id"] for c in sorted(cands, key=lambda c: c["ageDays"])]
    res = {"model_version": MODEL_VERSION, "k": k, "data": "synthetic"}
    policies = {
        "model": lambda p: [r["id"] for r in rank(cands, p, k)],
        "recency_baseline": lambda _p: recency[:k],
    }
    for name, fn in policies.items():
        ps, ns, ds = [], [], []
        for prof, rel in users:
            r = fn(prof)
            ps.append(precision_at_k(r, rel, k))
            ns.append(ndcg_at_k(r, rel, k))
            ds.append(diversity(r, topic_of))
        res[name] = {"precision@k": round(sum(ps) / len(ps), 3), "ndcg@k": round(sum(ns) / len(ns), 3), "diversity": round(sum(ds) / len(ds), 3)}
    covered = {r["id"] for prof, _ in users for r in rank(cands, prof, k)}
    res["model"]["coverage"] = round(len(covered) / len(cands), 3)
    res["cold_start_items"] = len(rank(cands, {"topics": [], "sources": [], "lessTopics": [], "personalization": True}, k))
    return res


if __name__ == "__main__":
    print(json.dumps(main(), indent=2))
