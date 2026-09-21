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
Type "payouts create --amount 10 --currency usd --payout_method_id potk_example --speed standard"
Sleep 400ms
Enter
Sleep 5s
Ctrl+D
Sleep 1500ms
