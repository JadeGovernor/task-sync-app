#!/bin/zsh
# 双击本文件即可启动本地网页服务（关闭终端窗口即停止）
cd "$(dirname "$0")"
echo "效率任务本地服务：http://127.0.0.1:8123/  （保持此窗口开着）"
exec python3 -c "
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', 8123), H).serve_forever()
"
