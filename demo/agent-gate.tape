Output demo/agent-gate.frames/
Source demo/_common.tape
Set Height 900
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; clear"
Enter
Sleep 500ms
Show
Type "wv products update prod_DQf7IZAtveRoK --title 'Frame Pro' | cat; echo exit ${pipestatus[1]}"
Sleep 300ms
Enter
Sleep 6s
