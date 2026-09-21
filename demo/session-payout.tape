Output demo/session-payout.frames/
Source demo/_common.tape
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; clear"
Enter
Sleep 500ms
Show
Type "wv"
Sleep 300ms
Enter
Sleep 2500ms
Type "payouts create --amount 250 --currency usd --payout_method_id potk_example --speed standard"
Sleep 400ms
Enter
Sleep 3500ms
Type "n"
Sleep 800ms
Enter
Sleep 2500ms
Ctrl+D
Sleep 1500ms
