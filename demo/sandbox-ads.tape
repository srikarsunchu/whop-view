Output demo/sandbox-ads.frames/
Source demo/_common.tape
Set Height 900
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; export WV_SANDBOX_URL=http://127.0.0.1:8931/api/v1 WV_SANDBOX_KEY=whop_sandbox_key; clear"
Enter
Sleep 500ms
Show
Type `wv --sandbox ads create --title 'Frame · v2' --url https://hypermotion.art/frame --call_to_action shop_now --ad_group_id adgrp_mock1 --headlines '["Frame is live"]'`
Sleep 300ms
Enter
Sleep 5s
Type "y"
Sleep 800ms
Enter
Sleep 4s
