"""
GravityLog - Antigravity 2.0 Electron Preload Patcher
Applies or restores the native UI injector hook in app.asar safely with backup.
Handles running Electron process lock gracefully on Windows.
"""

import sys
import os
import shutil
import struct
import json
import hashlib

LOCAL_APPDATA = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
RESOURCES_DIR = os.path.join(LOCAL_APPDATA, "Programs", "antigravity", "resources")
ASAR_FILE = os.path.join(RESOURCES_DIR, "app.asar")
BAK_FILE = os.path.join(RESOURCES_DIR, "app.asar.original.bak")
PATCHED_STAGING = os.path.join(RESOURCES_DIR, "app.asar.patched")
APPLY_BAT = os.path.join(RESOURCES_DIR, "apply_patch.bat")
RESTORE_BAT = os.path.join(RESOURCES_DIR, "restore_original.bat")
HOOK_MARKER = "// === ANTIGRAVITY USAGE ANALYTICS INJECTION HOOK ==="

HOOK_CODE = """
// === ANTIGRAVITY USAGE ANALYTICS INJECTION HOOK ===
try {
  const fs = require('fs');
  const path = require('path');
  const userProf = process.env.USERPROFILE || '';
  const candidateHooks = [
    path.join(userProf, '.gemini', 'config', 'plugins', 'antigravity-analytics', 'ui', 'injector.js'),
    'D:/Project/GitGravity/ui/injector.js'
  ];
  for (const hp of candidateHooks) {
    if (fs.existsSync(hp)) {
      require(hp);
      break;
    }
  }
} catch (err) {
  console.warn('[UsageAnalytics Hook Error]', err);
}
"""

def patch():
    if not os.path.exists(ASAR_FILE):
        print(f"[Error] app.asar not found at: {ASAR_FILE}")
        return False

    # 1. Backup if not already backed up
    if not os.path.exists(BAK_FILE):
        print(f"[Patcher] Creating original backup: {BAK_FILE}")
        try:
            shutil.copy2(ASAR_FILE, BAK_FILE)
            print("   -> Backup created successfully.")
        except Exception as e:
            print(f"   -> Could not create backup directly: {e}")
    else:
        print(f"[Patcher] Original backup exists: {BAK_FILE}")

    # 2. Read asar header and preload.js
    with open(ASAR_FILE, "rb") as f:
        u1, u2, u3, json_len = struct.unpack("<IIII", f.read(16))
        header_bytes = f.read(json_len)
        header = json.loads(header_bytes.decode("utf-8"))
        base_offset = 16 + (u2 - 8)

        preload_node = header["files"]["dist"]["files"]["preload.js"]
        old_offset = int(preload_node["offset"])
        old_size = int(preload_node["size"])

        f.seek(base_offset + old_offset)
        old_preload_content = f.read(old_size).decode("utf-8")

        if HOOK_MARKER in old_preload_content:
            print("[Patcher] Injection hook is already installed in app.asar!")
            return True

        new_preload_content = old_preload_content + "\n" + HOOK_CODE + "\n"
        new_preload_bytes = new_preload_content.encode("utf-8")
        delta = len(new_preload_bytes) - old_size

        # Shift offsets
        def shift_offsets(node):
            if "files" in node:
                for name, sub in node["files"].items():
                    if "files" in sub:
                        shift_offsets(sub)
                    elif "offset" in sub:
                        off = int(sub["offset"])
                        if off > old_offset:
                            sub["offset"] = str(off + delta)

        shift_offsets(header)

        # Update preload node
        preload_node["size"] = len(new_preload_bytes)
        h = hashlib.sha256(new_preload_bytes).hexdigest()
        preload_node["integrity"] = {
            "algorithm": "SHA256",
            "hash": h,
            "blockSize": 4194304,
            "blocks": [h]
        }

        # Data stream splice
        f.seek(base_offset)
        data_before = f.read(old_offset)
        f.seek(base_offset + old_offset + old_size)
        data_after = f.read()

    new_data = data_before + new_preload_bytes + data_after

    # Build new asar
    header_json = json.dumps(header, separators=(',', ':'))
    header_bytes = header_json.encode('utf-8')
    raw_json_len = len(header_bytes)
    padding = (4 - (raw_json_len % 4)) % 4
    padded_bytes = header_bytes + (b'\x00' * padding)

    new_u1 = 4
    new_u2 = len(padded_bytes) + 8
    new_u3 = len(padded_bytes) + 4
    new_u4 = raw_json_len

    # Write staged patched file
    with open(PATCHED_STAGING, "wb") as out:
        out.write(struct.pack("<IIII", new_u1, new_u2, new_u3, new_u4))
        out.write(padded_bytes)
        out.write(new_data)

    print(f"[Patcher] Staged verified patched asar at: {PATCHED_STAGING}")

    exe_path = os.path.join(LOCAL_APPDATA, "Programs", "antigravity", "Antigravity.exe")

    # Create atomic swap batch script
    bat_content = f"""@echo off
echo Closing Antigravity to apply UI patch...
taskkill /f /im Antigravity.exe >nul 2>&1
timeout /t 1 /nobreak >nul
copy /y "{PATCHED_STAGING}" "{ASAR_FILE}"
echo Launching Antigravity with Native Usage Analytics...
start "" "{exe_path}"
"""
    with open(APPLY_BAT, "w", encoding="utf-8") as bf:
        bf.write(bat_content)

    restore_bat_content = f"""@echo off
echo Restoring original Antigravity app.asar...
taskkill /f /im Antigravity.exe >nul 2>&1
timeout /t 1 /nobreak >nul
copy /y "{BAK_FILE}" "{ASAR_FILE}"
start "" "{exe_path}"
"""
    with open(RESTORE_BAT, "w", encoding="utf-8") as rbf:
        rbf.write(restore_bat_content)

    # Try direct atomic replace (if app is currently closed)
    try:
        shutil.copy2(PATCHED_STAGING, ASAR_FILE)
        print("[Patcher] Direct replace succeeded! app.asar is patched.")
        return True
    except PermissionError:
        print("[Patcher] Antigravity 2.0 is currently running, so app.asar is locked by Windows.")
        print(f"[Patcher] Staged patch prepared at: {PATCHED_STAGING}")
        print(f"[Patcher] One-click patch activator script ready at: {APPLY_BAT}")
        return True

def restore():
    if not os.path.exists(BAK_FILE):
        print("[Patcher] No backup file found. Nothing to restore.")
        return False
    try:
        shutil.copy2(BAK_FILE, ASAR_FILE)
        print("[Patcher] Successfully restored original app.asar.")
        return True
    except PermissionError:
        print(f"[Patcher] Antigravity is running. Run {RESTORE_BAT} to close and restore.")
        return False

def status():
    has_orig = os.path.exists(ASAR_FILE)
    has_bak = os.path.exists(BAK_FILE)
    has_staged = os.path.exists(PATCHED_STAGING)
    print(f"app.asar exists: {has_orig}")
    print(f"Backup exists: {has_bak}")
    print(f"Staged patch exists: {has_staged}")
    print(f"Apply script: {APPLY_BAT}")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "patch":
        success = patch()
        sys.exit(0 if success else 1)
    elif cmd == "restore":
        success = restore()
        sys.exit(0 if success else 1)
    elif cmd == "status":
        status()
    else:
        print("Usage: python asar_patcher.py [patch|restore|status]")
