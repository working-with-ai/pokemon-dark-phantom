import hashlib
import io
from pathlib import Path
import urllib.request
import zipfile


target = Path('/srv/pokemon-dark-phantom/pokemon-dark.gba')
expected_sha256 = '389363bb2c87b8f197f23d67c11e459cc9f46befec75dc57a9e6fdac898eccc2'
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
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.gba.tmp')
    temporary.write_bytes(contents)
    temporary.chmod(0o644)
    temporary.replace(target)
    print(f'Cached {len(contents)} bytes: {target}')
