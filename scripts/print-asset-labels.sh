#!/usr/bin/env bash
# Print Lockhaven asset labels from a site CSV export on a Brother PT-D460BT
# (PT-D460BTVP) using ptouch-print.
#
# Layout (18 mm tape): QR left + tag / serial (wrap) / company.
# Canvas 340×120 px (readable type; long serials wrap instead of shrinking).
# Settles between jobs and uses --timeout=30 (Phase 0).
#
# Usage:
#   ./scripts/print-asset-labels.sh path/to/asset-labels-….csv
#   ./scripts/print-asset-labels.sh --dry-run labels.csv   # write PNGs only
#   SETTLE_SECONDS=4 ./scripts/print-asset-labels.sh labels.csv
#   PTOUCH_PRECUT=0 ./scripts/print-asset-labels.sh labels.csv  # disable --precut
#   PTOUCH_SERIAL=E75J012345 ./scripts/print-asset-labels.sh labels.csv
#     (USB serial from `ptouch-print --list-connected`; Field Settings sets this)
#
# Left tape leader (~23 mm on PT-D460BT) is mostly a hardware gap between the
# print head and cutter. --precut (on by default) can shrink waste between
# chained labels; it does not remove the first-label leader.
#
# Requires: python3 (or a bundled venv next to this script), ptouch-print.
# Pillow/qrcode: bundled Field app venv, or repo-local scripts/.venv-labels.
# Fonts: bundled fonts/ when present; else DejaVu on the system.
# Install ptouch-print: ./scripts/install-ptouch-print.sh (unless bundled).
# CSV schema v1 columns: schema_version,tag,serial,company_name,qr_text,site_name
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${LOCKHAVEN_LABEL_VENV:-$SCRIPT_DIR/.venv-labels}"
REQ_FILE="$SCRIPT_DIR/requirements-labels.txt"
# Field .app / Linux bundle: private interpreter + fonts live beside this script.
if [[ -z "${LOCKHAVEN_LABEL_FONTS:-}" && -d "$SCRIPT_DIR/fonts" ]]; then
  export LOCKHAVEN_LABEL_FONTS="$SCRIPT_DIR/fonts"
fi
# Prefer a bundled tape tool over PATH (Resources/label-tools/bin).
export PATH="$SCRIPT_DIR/bin:${HOME:+$HOME/.local/bin}:$PATH"

SETTLE_SECONDS="${SETTLE_SECONDS:-3}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-30}"
# Default on: ask ptouch-print for a precut / chain-friendly left margin.
PTOUCH_PRECUT="${PTOUCH_PRECUT:-1}"
DRY_RUN=0
CSV_PATH=""

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

python_has_label_deps() {
  "$1" -c 'import qrcode; from PIL import Image, ImageDraw, ImageFont' 2>/dev/null
}

bundled_label_python() {
  if [[ -x "$SCRIPT_DIR/bin/label-python" ]]; then
    echo "$SCRIPT_DIR/bin/label-python"
    return 0
  fi
  if [[ -x "$SCRIPT_DIR/venv/bin/python" ]]; then
    echo "$SCRIPT_DIR/venv/bin/python"
    return 0
  fi
  if [[ -n "${LOCKHAVEN_LABEL_PYTHON:-}" && -x "${LOCKHAVEN_LABEL_PYTHON}" ]]; then
    echo "$LOCKHAVEN_LABEL_PYTHON"
    return 0
  fi
  return 1
}

ensure_label_venv() {
  local bundled
  if bundled="$(bundled_label_python)"; then
    if python_has_label_deps "$bundled"; then
      LABEL_PYTHON="$bundled"
      return 0
    fi
    echo "Bundled label Python is present but missing pillow/qrcode." >&2
  fi

  local python_bin="$VENV_DIR/bin/python"

  # Prefer a repo-local venv so Field/CI do not depend on global pip state.
  if [[ -x "$python_bin" ]] && python_has_label_deps "$python_bin"; then
    LABEL_PYTHON="$python_bin"
    return 0
  fi

  if [[ -x "$python_bin" ]]; then
    echo "Installing label print packages into $VENV_DIR …" >&2
    "$python_bin" -m pip install -r "$REQ_FILE"
    if python_has_label_deps "$python_bin"; then
      LABEL_PYTHON="$python_bin"
      return 0
    fi
  fi

  if [[ ! -d "$VENV_DIR" ]] || [[ ! -x "$python_bin" ]]; then
    echo "Creating label print venv at $VENV_DIR …" >&2
    if python3 -m venv "$VENV_DIR" >/dev/null 2>&1; then
      python_bin="$VENV_DIR/bin/python"
      "$python_bin" -m pip install --upgrade pip >/dev/null
      "$python_bin" -m pip install -r "$REQ_FILE"
      if python_has_label_deps "$python_bin"; then
        LABEL_PYTHON="$python_bin"
        return 0
      fi
      rm -rf "$VENV_DIR"
    else
      rm -rf "$VENV_DIR"
      echo "python3-venv unavailable; falling back to user-site packages." >&2
    fi
  fi

  # Fallback: system/user site-packages (pip install --user).
  if python_has_label_deps python3; then
    LABEL_PYTHON="python3"
    return 0
  fi
  echo "Installing pillow/qrcode for the current user …" >&2
  python3 -m pip install --user -r "$REQ_FILE"
  if python_has_label_deps python3; then
    LABEL_PYTHON="python3"
    return 0
  fi

  echo "Could not import pillow/qrcode." >&2
  echo "Install python3-venv, or: python3 -m pip install --user -r $REQ_FILE" >&2
  exit 1
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

if ! bundled_label_python >/dev/null; then
  need python3
fi
if [[ "$DRY_RUN" -eq 0 ]]; then
  need ptouch-print
fi

ensure_label_venv

OUT_DIR="${OUT_DIR:-$(mktemp -d -t lockhaven-labels.XXXXXX)}"
mkdir -p "$OUT_DIR"
echo "Working directory: $OUT_DIR"

export LOCKHAVEN_LABEL_CSV="$CSV_PATH"
export LOCKHAVEN_LABEL_OUT="$OUT_DIR"
export LOCKHAVEN_LABEL_DRY_RUN="$DRY_RUN"
export LOCKHAVEN_LABEL_SETTLE="$SETTLE_SECONDS"
export LOCKHAVEN_LABEL_TIMEOUT="$TIMEOUT_SECONDS"
export LOCKHAVEN_LABEL_PRECUT="$PTOUCH_PRECUT"
export PTOUCH_SERIAL="${PTOUCH_SERIAL:-}"

"$LABEL_PYTHON" <<'PY'
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
precut = os.environ.get("LOCKHAVEN_LABEL_PRECUT", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "",
)

# 18 mm tape printable height is ~120 px. Widen the label so long serials
# stay at readable point sizes (truncate/wrap instead of shrinking to 7–8 pt).
WIDTH, HEIGHT = 340, 120
QR_SIZE = 90
TEXT_X = 100
TEXT_RIGHT_PAD = 4


def load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    names = (
        ["DejaVuSans-Bold.ttf", "DejaVuSans.ttf"]
        if bold
        else ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"]
    )
    home = Path.home()
    bundled = os.environ.get("LOCKHAVEN_LABEL_FONTS", "").strip()
    roots = [
        bundled,
        "/usr/share/fonts/truetype/dejavu",
        "/usr/share/fonts/TTF",
        "/usr/share/fonts/dejavu",
        # macOS Homebrew font-dejavu cask → ~/Library/Fonts
        str(home / "Library" / "Fonts"),
        "/Library/Fonts",
        "/opt/homebrew/share/fonts",
        "/usr/local/share/fonts",
    ]
    for root in roots:
        if not root:
            continue
        for name in names:
            path = Path(root) / name
            if path.is_file():
                return ImageFont.truetype(str(path), size=size)
    raise SystemExit(
        "DejaVu fonts not found (needed for readable tape text). "
        "Field downloads include fonts next to the helper. "
        "Linux checkout: install fonts-dejavu-core. "
        "macOS checkout: brew install --cask font-dejavu."
    )


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


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
    max_lines: int,
) -> list[str]:
    """Wrap on spaces when possible; otherwise hard-break long tokens."""
    text = (text or "").strip() or "—"
    if max_lines <= 1:
        return [fit_text(draw, text, font, max_width)]

    def hard_wrap(token: str) -> list[str]:
        lines: list[str] = []
        remaining = token
        while remaining and len(lines) < max_lines:
            if len(lines) == max_lines - 1:
                lines.append(fit_text(draw, remaining, font, max_width))
                break
            cut = len(remaining)
            while cut > 1 and draw.textlength(remaining[:cut], font=font) > max_width:
                cut -= 1
            lines.append(remaining[:cut])
            remaining = remaining[cut:]
        return lines

    words = text.split()
    if len(words) <= 1:
        return hard_wrap(text) if draw.textlength(text, font=font) > max_width else [text]

    lines: list[str] = []
    current = ""
    pending = list(words)
    while pending:
        word = pending.pop(0)
        candidate = word if not current else f"{current} {word}"
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = ""
            pending.insert(0, word)
            if len(lines) == max_lines - 1:
                lines.append(fit_text(draw, " ".join(pending), font, max_width))
                return lines
            continue
        chunk_lines = hard_wrap(word)
        if len(lines) + len(chunk_lines) > max_lines:
            room = max_lines - len(lines)
            lines.extend(chunk_lines[:room])
            return lines
        lines.extend(chunk_lines[:-1])
        current = chunk_lines[-1] if chunk_lines else ""
        if len(lines) == max_lines - 1 and pending:
            lines.append(
                fit_text(
                    draw,
                    (current + " " + " ".join(pending)).strip(),
                    font,
                    max_width,
                )
            )
            return lines
    if current:
        lines.append(current)
    return lines[:max_lines] or ["—"]


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
    qr_y = max(0, (HEIGHT - QR_SIZE) // 2)
    canvas.paste(qr_img, (4, qr_y))

    draw = ImageDraw.Draw(canvas)
    max_text = WIDTH - TEXT_X - TEXT_RIGHT_PAD

    # Fixed readable sizes for 180 dpi tape — wrap/truncate, never shrink.
    font_tag = load_font(20, bold=True)
    font_serial = load_font(14, bold=True)
    font_company = load_font(12, bold=False)

    tag_text = fit_text(draw, tag.strip() or "—", font_tag, max_text)
    serial_lines = wrap_text(
        draw,
        serial.strip() if serial else "—",
        font_serial,
        max_text,
        max_lines=2,
    )
    company_text = fit_text(
        draw,
        company.strip() if company else "—",
        font_company,
        max_text,
    )

    draw.text((TEXT_X, 6), tag_text, fill=0, font=font_tag)
    y = 34
    for line in serial_lines:
        draw.text((TEXT_X, y), line, fill=0, font=font_serial)
        y += 18
    company_y = min(max(y + 4, 88), HEIGHT - 18)
    draw.text((TEXT_X, company_y), company_text, fill=0, font=font_company)
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
    cmd = ["ptouch-print", f"--timeout={timeout}"]
    printer_serial = os.environ.get("PTOUCH_SERIAL", "").strip()
    if printer_serial and printer_serial not in ("-", "auto"):
        # Field Settings / `ptouch-print --list-connected` USB serial.
        cmd.extend(["--serial", printer_serial])
    if precut:
        # Chain / small-margin mode. First label still has ~23 mm physical leader.
        cmd.append("--precut")
    cmd.extend(["--image", str(label_png)])
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)
    if index < len(rows):
        print(f"Settling {settle}s before next job…", flush=True)
        time.sleep(settle)

print(f"Done. {len(rows)} label(s). Artifacts in {out_dir}", flush=True)
PY
