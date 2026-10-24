"""Convert the supplied Google Fonts ZIP to self-hosted, lossless WOFF2 assets.

One-off asset preparation (not a build dependency):
  python -m pip install 'fonttools[woff]==4.60.1'
  python scripts/prepare-google-sans.py path/to/download.zip
Retains all characters, variable axes, shaping tables and copyright metadata.
"""
import io
from pathlib import Path
import shutil
import sys
import zipfile
from fontTools.ttLib import TTFont

destination = Path(__file__).resolve().parent.parent / 'fonts'
destination.mkdir(exist_ok=True)
with zipfile.ZipFile(sys.argv[1]) as archive:
    for source, name in [
        ('GoogleSans-VariableFont_GRAD,opsz,wght.ttf', 'google-sans-variable-v1.woff2'),
        ('GoogleSans-Italic-VariableFont_GRAD,opsz,wght.ttf', 'google-sans-italic-variable-v1.woff2'),
    ]:
        original = archive.read('Google_Sans/' + source)
        font = TTFont(io.BytesIO(original))
        assert font['name'].getDebugName(1) == 'Google Sans'
        assert all(ord(char) in font.getBestCmap() for char in 'SAPURIภาษาไทย0123456789')
        font.flavor = 'woff2'
        target = destination / name
        font.save(target)
        restored = TTFont(target)
        assert restored.getBestCmap() == font.getBestCmap()
        print(f'{name}: {len(original):,} -> {target.stat().st_size:,} bytes; Thai and all glyphs retained', flush=True)
    with archive.open('Google_Sans/OFL.txt') as source, (destination / 'Google-Sans-OFL.txt').open('wb') as target:
        shutil.copyfileobj(source, target)
