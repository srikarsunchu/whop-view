Output demo/dev-hook.frames/
Source demo/_common.tape
Set Height 600
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; export WV_WHOP_BIN=$PWD/demo/_fake/whop WV_FAKE_QUIET=1 WV_FAKE_READY=1 XDG_CACHE_HOME=$(mktemp -d); clear"
Enter
Sleep 500ms
Show
Type "wv dev hook https://hypermotion.art/hooks/v2 --events payment.succeeded,membership.activated --plan"
Sleep 300ms
Enter
Sleep 7s
