# Prints one verb's kind, gate, and required flags from `wv agent <group> --format json` on stdin. Used by demo/agent-index.tape.
import json, sys
d = json.load(sys.stdin)
v = [x for x in d["verbs"] if x["verb"] == "create"][0]
print(json.dumps({k: v[k] for k in ("verb", "kind", "gated", "required")}, indent=2))
