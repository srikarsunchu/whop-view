Output demo/exit-codes.frames/
Source demo/_common.tape
Set Height 620
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; clear"
Enter
Sleep 500ms
Show
Type "wv stats get --format json | cat; echo exit ${pipestatus[1]}"
Sleep 300ms
Enter
Sleep 3s
Type "wv economic-intelligence list --format json | cat; echo exit ${pipestatus[1]}"
Sleep 300ms
Enter
Sleep 3s
Type "wv prodcts list | cat; echo exit ${pipestatus[1]}"
Sleep 300ms
Enter
Sleep 3s
