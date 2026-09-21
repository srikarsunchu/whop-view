Output demo/logs-follow.frames/
Source demo/_common.tape
Set Height 620
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; export WV_SANDBOX_URL=http://127.0.0.1:8931/api/v1 WV_SANDBOX_KEY=whop_sandbox_key WV_FOLLOW_MS=1500; (node --experimental-strip-types --no-warnings scripts/mock-api.ts >/dev/null 2>&1 & sleep 30; kill $! 2>/dev/null) & sleep 1; clear"
Enter
Sleep 800ms
Show
Type "wv --sandbox apps logs app_mock1 --follow"
Sleep 300ms
Enter
Sleep 9s
Ctrl+C
Sleep 2s
