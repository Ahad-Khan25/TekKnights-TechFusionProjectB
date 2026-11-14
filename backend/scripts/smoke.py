"""Smoke test against a running server: python smoke.py [base_url]"""
import json
import sys
import time

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
c = httpx.Client(base_url=BASE, timeout=90)


def show(label, r):
    body = r.json()
    print(f"\n### {label} -> HTTP {r.status_code}")
    if "results" in body:
        print("state:", body["state"], "| urgent:", body["urgent_warning"])
        print("clarify:", body["clarifying_question"])
        for x in body["results"]:
            print(f"  - {x['test_raw']} -> {x['test']}: {x['value']} {x['unit']} => {x['status']} | {x['reason']}")
            if x["conversion"]:
                print("    conversion:", x["conversion"]["formula"])
            print("    explain:", x["explanation"][:160])
        print("questions:", json.dumps(body["doctor_questions"], ensure_ascii=False)[:400])
        print("summary:", body["summary"][:200])
        print("meta:", body["meta"])
    else:
        print(json.dumps(body, ensure_ascii=False)[:600])


show("health", c.get("/api/health"))
print("patients:", [(p["patient_id"], p["name"], p["age"], p["sex"]) for p in c.get("/api/patients").json()])
for pid in sys.argv[2:] or ["P005", "P012"]:
    t = time.time()
    show(f"analyze {pid}", c.post("/api/analyze", json={"patient_id": pid}))
    print(f"wall {time.time()-t:.1f}s")
t = time.time()
show("analyze P005 again (cache)", c.post("/api/analyze", json={"patient_id": "P005"}))
print(f"wall {time.time()-t:.2f}s")
show("analyze P012 with sex=female", c.post("/api/analyze", json={"patient_id": "P012", "sex": "female"}))
show("chat privacy", c.post("/api/chat", json={"patient_id": "P001", "question": "What was Diana Prince's hemoglobin?"}))
show("chat normal", c.post("/api/chat", json={"patient_id": "P001", "question": "What does WBC mean and is mine ok?"}))
show("empty", c.post("/api/analyze", json={"report_text": "   "}))
show("too large", c.post("/api/analyze", json={"report_text": "x" * 200_001}))
show("bad sex", c.post("/api/analyze", json={"patient_id": "P001", "sex": "alien"}))
show("unknown patient", c.post("/api/analyze", json={"patient_id": "P999"}))
show("malformed", c.post("/api/analyze", content=b"{not json", headers={"content-type": "application/json"}))
show("no results", c.post("/api/analyze", json={"report_text": "hello there, nothing here"}))
