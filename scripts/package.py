"""Create a deterministic ZIP of the already-built unpacked extension."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'dist/lineleaf'
assert (source / 'manifest.json').is_file(), 'Run npm run build first'
target = root / 'dist/lineleaf-0.1.0.zip'
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob('*')):
        if not path.is_file():
            continue
        info = zipfile.ZipInfo(path.relative_to(source).as_posix(), (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes())
print('Package: dist/lineleaf-0.1.0.zip')
