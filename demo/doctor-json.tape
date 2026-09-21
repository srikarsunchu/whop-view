Output demo/doctor-json.frames/
Source demo/_common.tape
Set Height 900
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; clear"
Enter
Sleep 500ms
Show
Type "wv doctor --format json | head -34"
Sleep 300ms
Enter
Sleep 8s
