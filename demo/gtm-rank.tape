Output demo/gtm-rank.frames/
Source demo/_common.tape
Set Height 560
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; export WV_WHOP_BIN=$PWD/demo/_fake/whop WV_FAKE_READY=1 WV_FAKE_QUIET=1 XDG_CACHE_HOME=$(mktemp -d); clear"
Enter
Sleep 500ms
Show
Type "wv gtm rank adcamp_1 --target 8"
Sleep 300ms
Enter
Sleep 6s
