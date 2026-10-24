"""Prepare self-hosted Google Sans for Thai/Latin shop text and common symbols.

One-off asset preparation (not a build dependency):
  python -m pip install 'fonttools[woff]==4.60.1'
  python scripts/prepare-google-sans.py path/to/download.zip
Retains Thai, Latin (including accents), Greek, common symbols, all variable
axes, shaping features and copyright metadata. Other scripts use CSS fallbacks.
"""
import io
from contextlib import nullcontext
from pathlib import Path
import shutil
import sys
import zipfile
from fontTools.ttLib import TTFont
from fontTools import subset

destination = Path(__file__).resolve().parent.parent / 'fonts'
destination.mkdir(exist_ok=True)
source_path = Path(sys.argv[1])
with (nullcontext(None) if source_path.is_dir() else zipfile.ZipFile(source_path)) as archive:
    for source, name in [
        ('GoogleSans-VariableFont_GRAD,opsz,wght.ttf', 'google-sans-variable-v2.woff2'),
        ('GoogleSans-Italic-VariableFont_GRAD,opsz,wght.ttf', 'google-sans-italic-variable-v2.woff2'),
    ]:
        original = archive.read('Google_Sans/' + source) if archive else (source_path / name.replace('-v2.', '-v1.')).read_bytes()
        font = TTFont(io.BytesIO(original))
        assert font['name'].getDebugName(1) == 'Google Sans'
        assert all(ord(char) in font.getBestCmap() for char in 'SAPURIภาษาไทย0123456789')
        original_cmap = font.getBestCmap()
        kept = {cp for cp in original_cmap if cp <= 0x03ff or 0x0e00 <= cp <= 0x0e7f
                or 0x1e00 <= cp <= 0x1eff or 0x2000 <= cp <= 0x2bff or cp in (0xfeff, 0xfffd)}
        options = subset.Options()
        options.layout_features = ['*']
        options.name_IDs = ['*']
        options.name_legacy = True
        options.name_languages = ['*']
        options.recalc_timestamp = False
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=kept)
        subsetter.subset(font)
        font.flavor = 'woff2'
        target = destination / name
        font.save(target)
        restored = TTFont(target)
        assert set(restored.getBestCmap()) == kept
        assert [a.axisTag for a in restored['fvar'].axes] == ['opsz', 'wght', 'GRAD']
        print(f'{name}: {len(original):,} -> {target.stat().st_size:,} bytes; {len(kept)} characters retained', flush=True)
    if archive:
        with archive.open('Google_Sans/OFL.txt') as source, (destination / 'Google-Sans-OFL.txt').open('wb') as target:
            shutil.copyfileobj(source, target)
