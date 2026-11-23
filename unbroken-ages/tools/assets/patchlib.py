"""Tiny client for the patch.gg asset index (openly licensed assets: Kenney, KayKit, Poly Haven, ambientCG, incompetech...).

The site is a Next.js app; search results and asset details are embedded in the page payload, so we read them from there.
Used by fetch_assets.py (downloads what assets.json lists and writes CREDITS.md) and search.py (finding candidates).
"""
import json, re, urllib.parse, urllib.request

BASE = "https://patch.gg/create/toolbox/assets"
UA = {"User-Agent": "unbroken-ages-asset-tool"}


def _payload(url):
    req = urllib.request.Request(url, headers=UA)
    html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    out = []
    for c in chunks:
        try:
            out.append(json.loads('"' + c + '"'))
        except json.JSONDecodeError:
            out.append(c.encode("latin-1", "backslashreplace").decode("unicode_escape", "ignore"))
    return "".join(out)


def _decode_at(txt, key):
    i = txt.find(key)
    if i < 0:
        return None
    return json.JSONDecoder().raw_decode(txt[i + len(key):])[0]


def search(kind, query="", license=None, extra=None):
    params = {"type": kind}
    if query:
        params["q"] = query
    if license:
        params["license"] = license
    if extra:
        params.update(extra)
    txt = _payload(BASE + "?" + urllib.parse.urlencode(params))
    return _decode_at(txt, '"hits":') or []


def detail(kind, asset_id):
    txt = _payload(BASE + "?" + urllib.parse.urlencode({"type": kind, "asset": asset_id}))
    return _decode_at(txt, '"detail":')


def download(url, path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r, open(path, "wb") as f:
        f.write(r.read())
