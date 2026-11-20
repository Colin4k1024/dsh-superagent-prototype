#!/usr/bin/env python3
"""Quarantine backup or corrupt DSH session directories before starting the service.

DSH's workspace registry scans `sessions/` and fails when a directory is not a valid session (for example a `.bak-*`
backup, or a session whose header id does not match its directory name). That failure cascades through the session
controller and blocks every component that waits for it. This preflight moves such directories under
`<home>/session-quarantine/<timestamp>/` and leaves valid sessions untouched.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time


def read_header(path):
    """Return the first JSON object of a session log, reading only its first line and stopping zstd."""
    try:
        process = subprocess.Popen(['zstd', '-dc', str(path)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except (FileNotFoundError, OSError):
        return None
    try:
        line = process.stdout.readline() if process.stdout else b''
    except OSError:
        line = b''
    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
        if process.stdout:
            process.stdout.close()
    try:
        value = json.loads(line.decode('utf-8', 'replace').strip())
    except (ValueError, AttributeError):
        return None
    return value if isinstance(value, dict) else None


def reason_for(session):
    """Return why a session directory is invalid, or None when it looks like a real session."""
    name = session.name
    if '.bak' in name or name.endswith('.tmp') or name.startswith('.'):
        return 'backup-or-temporary'
    log = session / 'session.v4.jsonl.zstd'
    if log.exists():
        header = read_header(log)
        if header is not None and header.get('id') != name:
            return 'header-id-mismatch'
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', default=os.environ.get('DSH_HOME') or str(Path.home() / '.dsh'),
                        help='DSH home (default: DSH_HOME or ~/.dsh)')
    parser.add_argument('--dry-run', action='store_true', help='Print what would move, without moving it')
    args = parser.parse_args()

    home = Path(args.home).expanduser()
    sessions = home / 'sessions'
    if not sessions.is_dir():
        print(json.dumps({'moved': [], 'checked': 0, 'note': 'no sessions directory'}))
        return 0

    stamp = time.strftime('%Y%m%d-%H%M%S')
    quarantine = home / 'session-quarantine' / stamp
    moved, checked = [], 0
    for profile in sorted(sessions.iterdir()):
        if not profile.is_dir():
            continue
        for session in sorted(profile.iterdir()):
            if not session.is_dir():
                continue
            checked += 1
            reason = reason_for(session)
            if not reason:
                continue
            destination = quarantine / profile.name / session.name
            record = {'profile': profile.name, 'session': session.name, 'reason': reason, 'to': str(destination)}
            if args.dry_run:
                moved.append(record)
                continue
            try:
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(session), str(destination))
                moved.append(record)
            except OSError as error:
                print(f'warning: could not quarantine {session}: {error}', file=sys.stderr)

    print(json.dumps({'moved': moved, 'checked': checked, 'quarantine': str(quarantine) if moved and not args.dry_run else None},
                     ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except OSError as error:
        print(f'session preflight failed: {error}', file=sys.stderr)
        sys.exit(1)
