#!/usr/bin/env sh
# Carwash POS local launcher (macOS / Linux)
cd "$(dirname "$0")" || exit 1

if command -v node >/dev/null 2>&1; then
  node server.js
  exit $?
fi

if command -v python3 >/dev/null 2>&1; then
  python3 tools/serve.py
  exit $?
fi

if command -v python >/dev/null 2>&1; then
  python tools/serve.py
  exit $?
fi

echo ""
echo "⚠️  مش لاقي Node.js ولا Python."
echo "    نزّل Node.js من https://nodejs.org أو Python 3 من https://python.org"
echo "    وبعدين شغّل ./start.sh تاني."
echo ""
exit 1
