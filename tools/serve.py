#!/usr/bin/env python3
"""Zero-dependency local static server for Carwash POS (Python fallback)."""
import http.server
import mimetypes
import os
import socket
import socketserver
import sys
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8080
URL = f"http://localhost:{PORT}"
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("application/manifest+json", ".webmanifest")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def port_busy(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) == 0


def main():
    if port_busy(PORT):
        print("\n⚠️  البورت 8080 مشغول بالفعل.")
        print(f"    جرّب تفتح: {URL}\n")
        print("    لو مش شغال، اقفل البرنامج اللي بيستخدم البورت وجرّب تاني.")
        input("\nاضغط Enter للإغلاق...")
        return 1
    try:
        with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as httpd:
            httpd.allow_reuse_address = True
            print("\n✅ مغسلة سيارات — الكاشير شغال محليًا")
            print(f"   العنوان: {URL}")
            print("   سيب النافذة دي مفتوحة أثناء استخدام التطبيق.")
            print("   للإغلاق: اضغط Ctrl + C أو اقفل النافذة.\n")
            try:
                webbrowser.open(URL + "/index.html")
            except Exception:
                pass
            httpd.serve_forever()
    except OSError as e:
        print("\n⚠️  حصل خطأ في تشغيل السيرفر:", e)
        print("    جرّب تشغيل start.bat كمسؤول.\n")
        input("اضغط Enter للإغلاق...")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
