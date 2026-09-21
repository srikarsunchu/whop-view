Output demo/approve.frames/
Source demo/_common.tape
Set Height 900
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; clear"
Enter
Sleep 500ms
Show
Type "wv products publish prod_DQf7IZAtveRoK | tail -16"
Sleep 300ms
Enter
Sleep 5s
Type "T=$(wv products publish prod_DQf7IZAtveRoK | python3 demo/_rerun_token.py)"
Sleep 300ms
Enter
Sleep 3s
Type "wv products publish prod_iQ2Zub6GFQS5Q --approve $T | cat; echo exit ${pipestatus[1]}"
Sleep 300ms
Enter
Sleep 5s
