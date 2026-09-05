# edge-tts CLI 包装：Windows 上强制 SelectorEventLoop
# 修复 Python 3.13 ProactorEventLoop 在 Edge 服务器重置连接时抛
# "finish_socket_func -> ov.getresult()" OSError 导致整个 CLI 崩溃的问题。
import asyncio
import sys

if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

from edge_tts.util import main

if __name__ == "__main__":
    sys.exit(main())
