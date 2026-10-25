import fcntl
import hashlib
import io
from pathlib import Path
import sys
import urllib.request
import zipfile


target = Path('/srv/pokemon-dark-phantom/pokemon-dark.gba')
cache_root = target.parent
cache_limit = 10_000_000_000
expected_sha256 = '389363bb2c87b8f197f23d67c11e459cc9f46befec75dc57a9e6fdac898eccc2'


def make_room(required_bytes):
    if required_bytes > cache_limit:
        raise ValueError('A single game exceeds the 10 GB cache limit')
    files = [(path, path.stat()) for path in cache_root.rglob('*')
             if path.is_file() and not path.is_symlink()]
    used_bytes = sum(stat.st_size for _, stat in files)
    for path, stat in sorted(files, key=lambda entry: entry[1].st_mtime):
        if used_bytes + required_bytes <= cache_limit:
            break
        path.unlink()
        used_bytes -= stat.st_size
        print(f'Evicted {stat.st_size} bytes: {path}')
    print(f'Cache usage: {used_bytes}/{cache_limit} bytes; reserved: {required_bytes}')


with open('/run/pokemon-dark-cache.lock', 'w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    cache_root.mkdir(parents=True, exist_ok=True)
    make_room(0)
    if '--prune-only' in sys.argv:
        raise SystemExit(0)
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == expected_sha256:
        print(f'Cache ready: {target}')
    else:
        url = 'https://mnqcdn.anan.pro/simulator/gba/kdygqhdmy50expbw.zip'
        with urllib.request.urlopen(url, timeout=90) as response:
            archive = response.read()
        with zipfile.ZipFile(io.BytesIO(archive)) as outer:
            nested = outer.read('kdygqhdmy50expbw/kdygqhdmy50expbw.zip')
        with zipfile.ZipFile(io.BytesIO(nested)) as inner:
            contents = inner.read('kdygqhdmy50expbw.gba')
        if len(contents) != 33554188 or hashlib.sha256(contents).hexdigest() != expected_sha256:
            raise ValueError('Downloaded ROM does not match the expected file')
        make_room(len(contents))
        temporary = target.with_suffix('.gba.tmp')
        temporary.write_bytes(contents)
        temporary.chmod(0o644)
        temporary.replace(target)
        print(f'Cached {len(contents)} bytes: {target}')
