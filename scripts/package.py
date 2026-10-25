"""Build a deterministic, allowlisted extension ZIP using only Python stdlib."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / 'extension'
RUNTIME_FILES = (
    'manifest.json', 'background.js', 'core.js', 'workspace.js',
    'options.html', 'options.css', 'options.js',
    'popup.html', 'popup.css', 'popup.js',
)
REPO_FILES = (
    'README.md', 'LICENSE', 'SECURITY.md',
    'docs/privacy.md', 'docs/changelog.md',
    'docs/verification.md', 'docs/development.md',
)
FILES = {name: EXTENSION / name for name in RUNTIME_FILES}
FILES.update({name: ROOT / name for name in REPO_FILES})


def archive_bytes():
    out = io.BytesIO()
    # Stored entries avoid cross-zlib-version differences. Times/modes are fixed.
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name in sorted(FILES):
            path = FILES[name]
            if path.is_symlink() or not path.is_file():
                raise ValueError(f'Expected a regular source file: {name}')
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
    return out.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate an existing package against source')
    args = parser.parse_args()
    manifest = json.loads((EXTENSION / 'manifest.json').read_text())
    version = manifest['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:\.\d+)?', version):
        raise ValueError('Invalid manifest version')
    target = ROOT / 'dist' / f'chatgpt-split-view-v{version}-candidate.zip'
    expected = archive_bytes()
    if args.check:
        if target.read_bytes() != expected:
            raise ValueError('Package bytes differ from current allowlisted source')
    else:
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(expected)
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != set(FILES):
            raise ValueError('Archive integrity or allowlist mismatch')
    print(f'PASS: {target.relative_to(ROOT)} ({len(expected)} bytes)')
    print(f'SHA256 {hashlib.sha256(expected).hexdigest()}')


if __name__ == '__main__':
    main()
