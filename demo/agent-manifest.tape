Output demo/agent-manifest.frames/
Source demo/_common.tape
Set Height 900
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; clear"
Enter
Sleep 500ms
Show
Type "wv agent payouts | sed -n '20,52p'"
Sleep 300ms
Enter
Sleep 6s
