Output demo/support-dispute.frames/
Source demo/_common.tape
Set Height 640
Hide
Type "export PATH=$PWD/node_modules/.bin:$PATH; alias wv='node $PWD/dist/bin.js'; export WV_WHOP_BIN=$PWD/demo/_fake/whop WV_FAKE_QUIET=1 XDG_CACHE_HOME=$(mktemp -d); clear"
Enter
Sleep 500ms
Show
Type "wv support dispute dsp_x1 --evidence file_a:digital_fulfillment,file_b:customer_order_history --plan"
Sleep 300ms
Enter
Sleep 7s
