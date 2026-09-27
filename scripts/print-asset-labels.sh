#!/usr/bin/env bash
# Print Lockhaven asset labels from a site CSV export on a Brother PT-D460BT
# (PT-D460BTVP) using ptouch-print.
#
# Layout (18 mm tape, locked): QR left + three text lines (tag, serial, company).
# Canvas ~210×120 px. Settles between jobs and uses --timeout=30 (Phase 0).
#
# Usage:
#   ./scripts/print-asset-labels.sh path/to/asset-labels-….csv
#   ./scripts/print-asset-labels.sh --dry-run labels.csv   # write PNGs only
#   SETTLE_SECONDS=4 ./scripts/print-asset-labels.sh labels.csv
#
# Requires: python3, Pillow, qrcode, ptouch-print
#   pip install --user pillow qrcode
# CSV schema v1 columns: schema_version,tag,serial,company_name,qr_text,site_name
set -euo pipefail

SETTLE_SECONDS="${SETTLE_SECONDS:-3}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-30}"
DRY_RUN=0
CSV_PATH=""

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$CSV_PATH" ]]; then
        echo "Unexpected argument: $1" >&2
        exit 2
      fi
      CSV_PATH="$1"
      shift
      ;;
  esac
done

if [[ -z "$CSV_PATH" || ! -f "$CSV_PATH" ]]; then
  usage >&2
  [[ -n "$CSV_PATH" ]] && echo "CSV not found: $CSV_PATH" >&2
  exit 2
fi

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need python3
if [[ "$DRY_RUN" -eq 0 ]]; then
  need ptouch-print
fi

if ! python3 -c 'import qrcode; from PIL import Image, ImageDraw, ImageFont' 2>/dev/null; then
  echo "Python packages required: pip install --user pillow qrcode" >&2
  exit 1
fi

OUT_DIR="${OUT_DIR:-$(mktemp -d -t lockhaven-labels.XXXXXX)}"
mkdir -p "$OUT_DIR"
echo "Working directory: $OUT_DIR"

export LOCKHAVEN_LABEL_CSV="$CSV_PATH"
export LOCKHAVEN_LABEL_OUT="$OUT_DIR"
export LOCKHAVEN_LABEL_DRY_RUN="$DRY_RUN"
export LOCKHAVEN_LABEL_SETTLE="$SETTLE_SECONDS"
export LOCKHAVEN_LABEL_TIMEOUT="$TIMEOUT_SECONDS"

python3 <<'PY'
import csv
import os
import subprocess
import time
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFont

csv_path = Path(os.environ["LOCKHAVEN_LABEL_CSV"])
out_dir = Path(os.environ["LOCKHAVEN_LABEL_OUT"])
dry_run = os.environ["LOCKHAVEN_LABEL_DRY_RUN"] == "1"
settle = float(os.environ["LOCKHAVEN_LABEL_SETTLE"])
timeout = os.environ["LOCKHAVEN_LABEL_TIMEOUT"]

WIDTH, HEIGHT = 210, 120
QR_SIZE = 92
TEXT_X = 104


def load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    names = (
        ["DejaVuSans-Bold.ttf", "DejaVuSans.ttf"]
        if bold
        else ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"]
    )
    roots = [
        "/usr/share/fonts/truetype/dejavu",
        "/usr/share/fonts/TTF",
        "/usr/share/fonts/dejavu",
    ]
    for root in roots:
        for name in names:
            path = Path(root) / name
            if path.is_file():
                return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def fit_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
) -> str:
    if not text:
        return "—"
    if draw.textlength(text, font=font) <= max_width:
        return text
    ellipsis = "…"
    trimmed = text
    while trimmed and draw.textlength(trimmed + ellipsis, font=font) > max_width:
        trimmed = trimmed[:-1]
    return (trimmed + ellipsis) if trimmed else ellipsis


def font_that_fits(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    preferred: int,
    minimum: int,
    bold: bool = False,
) -> tuple[ImageFont.ImageFont, str]:
    for size in range(preferred, minimum - 1, -1):
        font = load_font(size, bold=bold)
        if draw.textlength(text or "—", font=font) <= max_width:
            return font, text or "—"
    font = load_font(minimum, bold=bold)
    return font, fit_text(draw, text or "—", font, max_width)


def build_label(tag: str, serial: str, company: str, qr_text: str) -> Image.Image:
    canvas = Image.new("1", (WIDTH, HEIGHT), 1)
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=4,
        border=1,
    )
    qr.add_data(qr_text)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("1")
    qr_img = qr_img.resize((QR_SIZE, QR_SIZE), Image.Resampling.NEAREST)
    canvas.paste(qr_img, (4, 14))

    draw = ImageDraw.Draw(canvas)
    max_text = WIDTH - TEXT_X - 2
    font_tag, tag_text = font_that_fits(draw, tag, max_text, 13, 9, bold=True)
    font_serial, serial_text = font_that_fits(
        draw, serial or "—", max_text, 10, 8, bold=False
    )
    font_company, company_text = font_that_fits(
        draw, company or "—", max_text, 9, 7, bold=False
    )
    draw.text((TEXT_X, 10), tag_text, fill=0, font=font_tag)
    draw.text((TEXT_X, 40), serial_text, fill=0, font=font_serial)
    draw.text((TEXT_X, 68), company_text, fill=0, font=font_company)
    return canvas


with csv_path.open(newline="", encoding="utf-8-sig") as handle:
    reader = csv.DictReader(handle)
    if not reader.fieldnames:
        raise SystemExit("CSV has no header.")
    alias = {
        name.strip().lower().replace(" ", "_").replace("-", "_"): name
        for name in reader.fieldnames
    }
    for key in ("schema_version", "tag", "qr_text"):
        if key not in alias:
            raise SystemExit(f'Missing required column "{key}".')
    rows = list(reader)

if not rows:
    raise SystemExit("No label rows in CSV.")

for index, row in enumerate(rows, start=1):
    version = (row.get(alias["schema_version"]) or "").strip()
    if version != "1":
        raise SystemExit(f"Row {index}: unsupported schema_version {version!r}.")
    tag = (row.get(alias["tag"]) or "").strip()
    qr_text = (row.get(alias["qr_text"]) or "").strip()
    serial = (row.get(alias.get("serial", "serial"), "") or "").strip()
    company = (row.get(alias.get("company_name", "company_name"), "") or "").strip()
    if not tag or not qr_text:
        raise SystemExit(f"Row {index}: tag and qr_text are required.")

    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in tag)
    label_png = out_dir / f"{index:03d}-{safe}-label.png"
    image = build_label(tag, serial, company, qr_text)
    # 1-bit PNG (2-color) for ptouch-print
    image.save(label_png, format="PNG")
    print(f"Label {index}/{len(rows)}: {tag} -> {label_png}", flush=True)

    if dry_run:
        continue
    cmd = ["ptouch-print", f"--timeout={timeout}", "--image", str(label_png)]
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)
    if index < len(rows):
        print(f"Settling {settle}s before next job…", flush=True)
        time.sleep(settle)

print(f"Done. {len(rows)} label(s). Artifacts in {out_dir}", flush=True)
PY
