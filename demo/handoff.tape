# The two screens at 80 columns, on the live account, for the handoff. 22 seconds.
Output demo/handoff.frames/
Source demo/_common.tape
Set Width 920
Set Height 760
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; stty cols 80; clear"
Enter
Sleep 500ms
Show
Type "wv money"
Sleep 400ms
Enter
Sleep 9s
Type "clear"
Enter
Sleep 300ms
Type "wv store --from DE"
Sleep 400ms
Enter
Sleep 11s
