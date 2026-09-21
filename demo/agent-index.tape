Output demo/agent-index.frames/
Source demo/_common.tape
Set Height 900
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; clear"
Enter
Sleep 500ms
Show
Type "wv agent | sed -n '/^## ads/,/^## media/p'"
Sleep 300ms
Enter
Sleep 5s
Type "wv agent payouts --format json | python3 demo/_verb_create.py"
Sleep 300ms
Enter
Sleep 5s
