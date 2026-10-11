"""Explicit model download; never runs automatically when transcribing."""
import argparse
from pathlib import Path
from faster_whisper.utils import download_model

parser = argparse.ArgumentParser(description='Download a multilingual Whisper model after reviewing its size.')
parser.add_argument('quality', choices=['fast', 'balanced', 'high'])
parser.add_argument('--consent', action='store_true', help='Confirm this model download and its storage requirements')
args = parser.parse_args()
names = {'fast': ('tiny', '~75 MB'), 'balanced': ('small', '~500 MB'), 'high': ('large-v3', '~3 GB')}
name, size = names[args.quality]
if not args.consent:
    parser.error(f'{name} needs approximately {size} of download/storage, plus runtime memory. Re-run with --consent to authorize the download.')
output = Path(__file__).resolve().parent / 'models' / name
print('Downloading', name, 'to', output)
download_model(name, output_dir=str(output))
print('Model ready. Restart or recheck the companion in Settings.')
