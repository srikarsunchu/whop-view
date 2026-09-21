Output demo/gtm-winback.frames/
Source demo/_common.tape
Set Height 760
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; export WV_WHOP_BIN=$PWD/demo/_fake/whop WV_FAKE_READY=1 WV_FAKE_QUIET=1 WV_AD_CAP=none XDG_CACHE_HOME=$(mktemp -d); clear"
Enter
Sleep 500ms
Show
Type "wv gtm winback adcamp_1 --budget 15 --plan"
Sleep 300ms
Enter
Sleep 7s
