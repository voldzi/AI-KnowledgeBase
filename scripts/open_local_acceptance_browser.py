#!/usr/bin/env python3
"""Open an isolated Chrome profile with trust pinned to this test TLS key only.

Does not modify macOS trust, the ordinary Chrome profile, or remote TLS policy.
"""
import base64
import hashlib
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "data/local-acceptance"
chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
if not chrome.is_file():
    raise SystemExit("Google Chrome is required for the isolated local test browser")
public_key = subprocess.check_output(["openssl", "x509", "-in", str(STATE / "tls/server.pem"), "-pubkey", "-noout"])
der = subprocess.check_output(["openssl", "pkey", "-pubin", "-outform", "DER"], input=public_key)
pin = base64.b64encode(hashlib.sha256(der).digest()).decode()
profile = STATE / "chrome-profile"
profile.mkdir(mode=0o700, exist_ok=True)
subprocess.Popen([
    str(chrome), "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=" + str(profile),
    "--host-resolver-rules=MAP login.akb.localhost 127.0.0.1",
    "--ignore-certificate-errors-spki-list=" + pin,
    "http://localhost:3240", "http://localhost:3220/akb", "http://localhost:3221",
], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
print("Opened the isolated local acceptance browser; normal browser trust is unchanged.")
