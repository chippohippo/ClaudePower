"""python3 tools/assets/search.py <type> "<query>" [CC0-1.0]  -> id | license | source | title | traits"""
import sys
import patchlib
kind, q = sys.argv[1], sys.argv[2]
lic = sys.argv[3] if len(sys.argv) > 3 else None
for h in patchlib.search(kind, q, lic)[:int(sys.argv[4]) if len(sys.argv) > 4 else 25]:
    fit = h.get("fit") or {}
    print(f'{h["id"]} | {h["license"]} | {h["source"]} | {h["title"]} | {",".join(h.get("traits") or [])} | {fit.get("triangles","")}tri {fit.get("mb","")}MB')
