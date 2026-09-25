#!/usr/bin/env python3
"""Cross-domain evaluation agent for the five AIP-C01 audit updates.

Run after all five update scripts have been applied. It evaluates:
- official blueprint shape and weighting
- proportional question coverage
- removal of template/giveaway distractors
- specific factual fixes from each domain audit
- learning coverage metadata and glossary quality
- duplicate question prompts
- the repository's real Rust content validator/tests
"""
from __future__ import annotations
from collections import Counter
from pathlib import Path
import argparse
import json
import math
from common import (
    AUDIT_DATE, AuditError, find_repo_root, load_json,
    assert_learning_coverage_counts, run_rust_validation, longest_interaction_run,
    GENERIC_EVIDENCE_HINT,
)

OFFICIAL_WEIGHTS = {
    "domain-1": 0.31,
    "domain-2": 0.26,
    "domain-3": 0.20,
    "domain-4": 0.12,
    "domain-5": 0.11,
}
EXPECTED_TASKS = {
    "domain-1": {"1.1","1.2","1.3","1.4","1.5","1.6"},
    "domain-2": {"2.1","2.2","2.3","2.4","2.5"},
    "domain-3": {"3.1","3.2","3.3","3.4"},
    "domain-4": {"4.1","4.2","4.3"},
    "domain-5": {"5.1","5.2"},
}
BANNED_TEMPLATE_DISTRACTORS = {
    "Amazon EC2 Auto Scaling", "Route 53 geolocation routing",
    "S3 Glacier Deep Archive", "Route 53 failover records",
    "EC2 placement groups", "S3 Transfer Acceleration",
    "AWS Backup restore testing", "Route 53 latency routing",
    "Auto Scaling lifecycle hook", "CloudFormation drift detection",
}

def question(doc, qid):
    return next(q for q in doc["questions"] if q["id"] == qid)

def option_labels(q):
    return {o["id"]: o["label"] for o in q["interaction"].get("options", [])}

def evidence_labels(q):
    return {e["id"]: e["label"] for e in q["interaction"].get("evidence", [])}

def text_blob(doc):
    return json.dumps(doc, ensure_ascii=False).casefold()

def evaluate(repo: Path) -> int:
    learning = {}
    questions = {}
    failures = []
    notes = []

    for d in range(1, 6):
        learning[d] = load_json(repo / f"content/aws/aip-c01/v1/learning/learning-domain-{d}.json")
        questions[d] = load_json(repo / f"content/aws/aip-c01/v1/questions/aws-aip-c01-domain-{d}.json")
        try:
            assert_learning_coverage_counts(learning[d])
        except Exception as exc:
            failures.append(f"D{d} learning coverage metadata: {exc}")

        expected_lv = f"aip-c01-learning-{AUDIT_DATE}-v3-domain{d}"
        expected_qv = f"aip-c01-content-{AUDIT_DATE}-v3-domain{d}"
        if learning[d].get("content_version") != expected_lv:
            failures.append(f"D{d} learning content_version is not audited v3")
        if questions[d].get("version", {}).get("content_version") != expected_qv:
            failures.append(f"D{d} question content_version is not audited v3")

        glossary = learning[d].get("glossary", [])
        if len(glossary) < 6:
            failures.append(f"D{d} glossary has only {len(glossary)} terms; expected >= 6")

        prompts = [q.get("prompt","").strip() for q in questions[d]["questions"]]
        duplicates = [p for p,c in Counter(prompts).items() if p and c > 1]
        if duplicates:
            failures.append(f"D{d} duplicate question prompts: {duplicates[:3]}")

        # Every question file should expose exactly one authored domain with the expected tasks.
        active = [x for x in questions[d]["version"]["domains"] if x.get("tasks")]
        if len(active) != 1 or active[0]["id"] != f"domain-{d}":
            failures.append(f"D{d} question file does not have exactly one active matching domain")
        else:
            tasks = {t["id"] for t in active[0]["tasks"]}
            if tasks != EXPECTED_TASKS[f"domain-{d}"]:
                failures.append(f"D{d} task coverage mismatch: {sorted(tasks)}")

        # Authored order must not create 3+ identical interaction types in a row.
        run = longest_interaction_run(questions[d])
        if run > 2:
            failures.append(f"D{d} longest same-interaction run is {run}; expected <= 2")

        # Generic evidence-selection hints were a template artifact and should be gone.
        generic_hint_questions = [
            q["id"] for q in questions[d]["questions"]
            if q.get("hints") == [GENERIC_EVIDENCE_HINT]
        ]
        if generic_hint_questions:
            failures.append(
                f"D{d} still contains generic evidence-selection hints: "
                f"{generic_hint_questions[:4]}"
            )

        # No original giveaway distractors should survive.
        found_bad = []
        for q in questions[d]["questions"]:
            for e in q.get("interaction", {}).get("evidence", []):
                if e.get("label") in BANNED_TEMPLATE_DISTRACTORS:
                    found_bad.append((q["id"], e["label"]))
        if found_bad:
            failures.append(f"D{d} still contains template distractors: {found_bad[:4]}")

    # Weighting and proportional question coverage.
    domain_weights = {}
    counts = {}
    for d in range(1, 6):
        active = next(x for x in questions[d]["version"]["domains"] if x.get("tasks"))
        domain_weights[active["id"]] = active["weight"]
        counts[active["id"]] = len(questions[d]["questions"])
    if domain_weights != OFFICIAL_WEIGHTS:
        failures.append(f"Official weight mismatch: {domain_weights}")
    total_q = sum(counts.values())
    for did, official in OFFICIAL_WEIGHTS.items():
        observed = counts[did] / total_q
        delta = abs(observed - official)
        notes.append(f"{did}: {counts[did]} questions, {observed:.1%} of bank vs {official:.0%} blueprint")
        if delta > 0.025:
            failures.append(
                f"{did} question share {observed:.1%} differs from blueprint {official:.0%} by >2.5 pp"
            )

    # Domain-specific audit assertions.
    d1 = questions[1]
    if option_labels(question(d1, "aip-1-5-1-best-fit-contrast")).get("o1") != "hierarchical chunking":
        failures.append("D1 hierarchical-chunking correction missing")
    if "hybrid lexical + semantic search" not in option_labels(question(d1, "aip-1-5-4-best-fit-contrast")).values():
        failures.append("D1 hybrid-search correction missing")
    if option_labels(question(d1, "aip-1-4-4-best-fit-contrast")).get("o1") != "Amazon Bedrock Knowledge Bases":
        failures.append("D1 managed Knowledge Bases correction missing")

    d2 = questions[2]
    if option_labels(question(d2, "aip-2-2-1-best-fit-contrast")).get("o1") != "Bedrock Provisioned Throughput":
        failures.append("D2 Provisioned Throughput correction missing")
    if "sqs" not in text_blob(learning[2]):
        failures.append("D2 learning still does not explicitly teach SQS async processing")

    d3 = questions[3]
    if option_labels(question(d3, "aip-3-2-2-best-fit-contrast")).get("o1") != "Amazon Macie":
        failures.append("D3 Macie stored-S3 discovery correction missing")
    d3text = text_blob(learning[3])
    for term in ("lake formation", "token-level redaction", "llm-as-a-judge"):
        if term not in d3text:
            failures.append(f"D3 official-example coverage missing: {term}")

    d4 = questions[4]
    if evidence_labels(question(d4, "aip-4-2-4-tune-inference-parameters")).get("o3") != "A/B testing candidate parameter configurations":
        failures.append("D4 A/B inference-parameter evaluation correction missing")
    d4text = text_blob(learning[4])
    for term in ("semantic caching", "deterministic request", "a/b testing"):
        if term not in d4text:
            failures.append(f"D4 optimization coverage missing: {term}")

    d5 = questions[5]
    labels = evidence_labels(question(d5, "aip-5-1-6-evaluate-retrieval-subsystem-quali"))
    if any("latency" in v.casefold() for v in labels.values()):
        failures.append("D5 missing-evidence question still treats latency as a primary diagnostic")
    for need in ("recall", "freshness", "ranking"):
        if not any(need in v.casefold() for v in labels.values()):
            failures.append(f"D5 retrieval diagnostic missing {need}")

    print("\nCross-domain evaluation")
    print("=======================")
    for note in notes:
        print("  ", note)
    if failures:
        print("\nSTATIC EVALUATION FAILURES:")
        for f in failures:
            print(" -", f)
        print("\nRust validation was not run because static evaluation already failed.")
        return 1

    print("\nStatic quality gates passed. Running real Rust content validation/tests...")
    try:
        run_rust_validation(repo)
    except Exception as exc:
        print("\nRUST VALIDATION FAILED:", exc)
        return 1

    print("\nFINAL EVALUATION: PASS")
    print("All five domain updates satisfy the audit gates and the repository Rust validator.")
    return 0

def main():
    p = argparse.ArgumentParser(description="Evaluate all five AIP-C01 domain audit updates.")
    p.add_argument("--repo", type=Path, default=None)
    args = p.parse_args()
    repo = find_repo_root(args.repo)
    raise SystemExit(evaluate(repo))

if __name__ == "__main__":
    main()
