Output demo/ads-create.frames/
Source demo/_common.tape
Set Height 900
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; clear"
Enter
Sleep 500ms
Show
Type `wv ads create --title 'Frame · launch v1' --url https://hypermotion.art/frame --call_to_action shop_now --ad_group '{"ad_campaign_id":"adcamp_x1","title":"US 25-44 · purchase","budget_amount":15,"budget_type":"daily","optimization_goal":"conversions","conversion_event":"purchase","placements":"automatic","demographics":{"minimum_age":25,"maximum_age":44,"gender":"all"},"regions":{"include":{"countries":["US"]}}}' --headlines '["Frame is live"]'`
Sleep 300ms
Enter
Sleep 6s
Type "n"
Sleep 800ms
Enter
Sleep 2s
