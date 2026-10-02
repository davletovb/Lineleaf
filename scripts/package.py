"""Create a deterministic ZIP of the already-built unpacked extension."""
from pathlib import Path
import argparse
import json
import os
import re
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]


def deterministic_zip(source, target):
    source, target = Path(source).resolve(), Path(target).resolve()
    if target.is_relative_to(source):
        raise ValueError('archive must be outside its input directory')
    if not source.is_dir():
        raise ValueError('missing package input directory')
    paths = sorted(source.rglob('*'))
    if any(path.is_symlink() for path in paths):
        raise ValueError('symlink in package input')
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.lineleaf-package-', dir=target.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for path in paths:
                if not path.is_file():
                    continue
                info = zipfile.ZipInfo(path.relative_to(source).as_posix(), (2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes())
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=root / 'dist/lineleaf')
    parser.add_argument('--target', type=Path)
    args = parser.parse_args()
    if args.target is None:
        manifest = json.loads((args.source / 'manifest.json').read_text())
        version = manifest['version']
        if not isinstance(version, str) or not re.fullmatch(r'\d+(?:\.\d+){0,3}', version):
            parser.error('invalid extension version')
        target = root / f'dist/lineleaf-{version}.zip'
    else:
        target = args.target
    deterministic_zip(args.source, target)
    print(f'Package: {target.relative_to(root) if target.is_relative_to(root) else target.name}')


if __name__ == '__main__':
    main()
