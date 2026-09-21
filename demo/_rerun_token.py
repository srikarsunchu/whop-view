# Prints the --approve token from a wv confirmation envelope on stdin. Used by demo/approve.tape.
import json, sys
print(json.load(sys.stdin)["rerun"][-1])
