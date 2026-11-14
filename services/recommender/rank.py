"""Ranking de recomendacoes do Jornal Medico.

Contrato (igual ao baseline TypeScript em apps/server/src/modules/ranking.ts):
  entrada: {"candidates": [Candidate], "profile": Profile, "k": int}
  saida:   {"ranked": [{"id", "score", "reasons"}], "model_version": str}

MODEL_VERSION "content-tfidf-v1": baseline explicavel + similaridade de conteudo
(TF-IDF sobre temas) com o perfil. Nenhum modelo foi treinado com dados reais: ainda nao
ha dados elegiveis. Rollback = remover RECOMMENDER_URL (o servidor usa o baseline TS).
"""
from __future__ import annotations

import math

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

MODEL_VERSION = "content-tfidf-v1"
W = {"recency": 0.3, "topic": 0.35, "source": 0.1, "priority": 0.25, "half_life": 7.0,
     "read_penalty": 0.3, "less_penalty": 0.5, "max_per_topic": 2, "content": 0.15}


def _personal(p: dict) -> bool:
    return bool(p.get("personalization")) and bool(p.get("topics") or p.get("sources") or p.get("lessTopics"))


def content_similarity(cands: list[dict], profile_topics: list[str]) -> list[float]:
    """Similaridade cosseno TF-IDF entre os temas do candidato e os temas seguidos."""
    if not profile_topics or not cands:
        return [0.0] * len(cands)
    docs = [" ".join(c["topics"]) for c in cands] + [" ".join(profile_topics)]
    m = TfidfVectorizer(token_pattern=r"[^ ]+").fit_transform(docs)
    return cosine_similarity(m[:-1], m[-1]).ravel().tolist()


def rank(candidates: list[dict], profile: dict, k: int) -> list[dict]:
    personal = _personal(profile)
    follows = set(profile.get("topics", []))
    less = set(profile.get("lessTopics", []))
    sims = content_similarity(candidates, list(follows)) if personal else [0.0] * len(candidates)
    scored = []
    for c, sim in zip(candidates, sims):
        reasons: list[str] = []
        recency = math.exp(-math.log(2) * max(0.0, c["ageDays"]) / W["half_life"])
        s = W["recency"] * recency + W["priority"] * min(1.0, max(0.0, c["priority"]))
        matched = next((t for t in c["topics"] if t in follows), None)
        if personal and matched:
            s += W["topic"]
            label = c.get("labels", {}).get(matched, matched)
            reasons.append(f"Você segue {label}")
        if personal:
            s += W["content"] * sim
            if c["source"] in profile.get("sources", []):
                s += W["source"]
            if any(t in less for t in c["topics"]):
                s -= W["less_penalty"]
                reasons.append("Menos peso: você pediu menos deste tema")
        if c.get("read"):
            s -= W["read_penalty"]
        if c["priority"] >= 0.7:
            reasons.append("Destaque editorial")
        if recency > 0.8:
            reasons.append("Publicado recentemente")
        if not personal:
            reasons.append("Seleção geral")
        if not reasons:
            reasons.append("Seleção editorial recente")
        scored.append({"c": c, "s": s, "reasons": reasons, "matched": bool(matched)})
    scored.sort(key=lambda x: (-x["s"], x["c"]["id"]))

    out, per_topic = [], {}
    for x in scored:
        if len(out) >= k:
            break
        t = x["c"]["primaryTopic"]
        if per_topic.get(t, 0) >= W["max_per_topic"]:
            continue
        per_topic[t] = per_topic.get(t, 0) + 1
        out.append(x)
    if personal and len(out) > 1 and all(x["matched"] for x in out):
        outsider = next((x for x in scored if not x["matched"] and x not in out), None)
        if outsider:
            outsider["reasons"].append("Para ampliar o olhar: fora dos seus temas")
            out[-1] = outsider
    return [{"id": x["c"]["id"], "score": round(x["s"], 3), "reasons": x["reasons"]} for x in out]


# ---------------- Avaliacao offline ----------------
def precision_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    return sum(1 for r in ranked[:k] if r in relevant) / k if k else 0.0


def ndcg_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    dcg = sum(1 / math.log2(i + 2) for i, r in enumerate(ranked[:k]) if r in relevant)
    ideal = sum(1 / math.log2(i + 2) for i in range(min(k, len(relevant))))
    return dcg / ideal if ideal else 0.0


def diversity(ranked: list[str], topic_of: dict[str, str]) -> float:
    return len({topic_of[r] for r in ranked}) / len(ranked) if ranked else 0.0
