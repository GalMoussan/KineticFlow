"""Reel Studio music-ai add-on: download the pinned ACE-Step 1.5 checkpoints and verify every file.

    sidecar/music-ai/.venv/bin/python sidecar/music-ai/fetch_models.py <dest>

`models.json` (next to this script) pins the Hugging Face repo to one revision and lists every file with the hash the
Hub publishes for it: SHA-256 for LFS files (the weights), the git blob SHA-1 for small text files. Files that are
already present and verified are skipped (a stamp of size + mtime avoids re-hashing 10 GB on every run), so the
script is idempotent. Prints one `progress <done> <total>` line per file and one line per file; exits 1 on a hash
mismatch (the bad file is deleted).

ACE-Step treats the model code in its own package (`acestep/models/<variant>/*.py`) as authoritative and copies it
over the checkpoint's `.py` files when they differ. This script does that copy once, here, so generation never
writes into the model folder; such a file verifies when it equals either the Hub blob or the installed package copy.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import shutil
import time
from pathlib import Path

MANIFEST = Path(__file__).with_name("models.json")
STAMP = ".reel-verified.json"


def package_copy(rel: str) -> Path | None:
    """The installed ACE-Step package's copy of a checkpoint code file, if it ships one."""
    from acestep.model_downloader import _CHECKPOINT_TO_VARIANT, _get_models_source_dir

    model, _, name = rel.partition("/")
    variant = _CHECKPOINT_TO_VARIANT.get(model)
    if not variant or not name.endswith(".py"):
        return None
    src = _get_models_source_dir() / variant / name
    return src if src.exists() else None


def same_bytes(a: Path, b: Path) -> bool:
    return a.stat().st_size == b.stat().st_size and a.read_bytes() == b.read_bytes()


def file_hash(path: Path, entry: dict) -> bool:
    if "sha256" in entry:
        h = hashlib.sha256()
        want = entry["sha256"]
    else:
        h = hashlib.sha1()
        h.update(f"blob {path.stat().st_size}\0".encode())
        want = entry["gitSha1"]
    with path.open("rb") as f:
        for block in iter(lambda: f.read(8 << 20), b""):
            h.update(block)
    return h.hexdigest() == want


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    dest = Path(sys.argv[1]).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    m = json.loads(MANIFEST.read_text())
    stamp_path = dest / STAMP
    stamp = json.loads(stamp_path.read_text()) if stamp_path.exists() else {}
    if stamp.get("revision") != m["revision"]:
        stamp = {"revision": m["revision"], "files": {}}
    total = sum(f["bytes"] for f in m["files"])
    done = 0
    fetched = 0
    t0 = time.time()

    from huggingface_hub import hf_hub_download
    from huggingface_hub.utils import disable_progress_bars

    disable_progress_bars()
    for entry in m["files"]:
        rel = entry["path"]
        path = dest / rel
        st = path.stat() if path.exists() else None
        known = stamp["files"].get(rel)
        if st and known and known == [st.st_size, st.st_mtime_ns]:
            done += entry["bytes"]
            continue
        pkg = package_copy(rel)
        ok = st is not None and ((st.st_size == entry["bytes"] and file_hash(path, entry)) or (pkg is not None and same_bytes(path, pkg)))
        if not ok:
            print(f"download {rel} ({entry['bytes'] / 1e6:.1f} MB)", flush=True)
            hf_hub_download(m["repo"], rel, revision=m["revision"], local_dir=str(dest))
            fetched += entry["bytes"]
            if not file_hash(path, entry):
                path.unlink(missing_ok=True)
                print(f"hash mismatch: {rel} (deleted); expected {entry.get('sha256') or entry.get('gitSha1')}", file=sys.stderr)
                return 1
        kind = "sha256" if "sha256" in entry else "git-sha1"
        if pkg is not None and not same_bytes(path, pkg):
            shutil.copy2(pkg, path)
            kind += ", then replaced by the ACE-Step package's copy"
        st = path.stat()
        stamp["files"][rel] = [st.st_size, st.st_mtime_ns]
        stamp_path.write_text(json.dumps(stamp, indent=1))
        done += entry["bytes"]
        print(f"verified {rel} ({entry['bytes'] / 1e6:.1f} MB, {kind})", flush=True)
        print(f"progress {done} {total}", flush=True)
    print(json.dumps({"repo": m["repo"], "revision": m["revision"], "files": len(m["files"]), "bytes": total,
                      "downloaded": fetched, "seconds": round(time.time() - t0, 1)}), flush=True)
    return 0


if __name__ == "__main__":
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    sys.exit(main())
