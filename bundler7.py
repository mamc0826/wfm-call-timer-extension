#!/usr/bin/env python3

from pathlib import Path
import json
import argparse
import sys
import re

# ============================================================
# CLI ARGS
# ============================================================

parser = argparse.ArgumentParser(
    description="Export project files into a single AI context file."
)

parser.add_argument(
    "--root",
    type=Path,
    default=Path.cwd(),
    help="Root directory of the project (default: current directory)"
)

parser.add_argument(
    "--output",
    type=str,
    default="AI_CONTEXT.txt",
    help="Output filename (default: AI_CONTEXT.txt)"
)

parser.add_argument(
    "--max-file-kb",
    type=int,
    default=250,
    help="Max size per file in KB before truncating (default: 250)"
)

parser.add_argument(
    "--max-total-kb",
    type=int,
    default=5120,
    help="Max total output size in KB (default: 5120 = 5MB)"
)

parser.add_argument(
    "--preview-lines",
    type=int,
    default=200,
    help="Lines to preview for large files (default: 200)"
)

args = parser.parse_args()

ROOT          = args.root.resolve()
OUTPUT_FILE   = args.output
MAX_FILE_KB   = args.max_file_kb
MAX_TOTAL_KB  = args.max_total_kb
PREVIEW_LINES = args.preview_lines

# Self-exclusion — never include this script or its output
SELF_NAME   = Path(__file__).resolve()
OUTPUT_PATH = ROOT / OUTPUT_FILE

# ============================================================
# CONFIG
# ============================================================

IGNORE_DIRS = {
    "node_modules", ".git", "dist", "build", ".next", ".turbo",
    ".cache", "__pycache__", "venv", ".venv", "coverage",
    "bin", "obj", ".idea", ".vscode", "Pods", "vendor"
}

IMPORTANT_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".yaml", ".yml",
    ".md", ".txt", ".html", ".css", ".scss", ".sql", ".sh", ".ps1",
    ".toml", ".ini", ".cfg"
}

PRIORITY_FILES = {
    "package.json", "requirements.txt", "pyproject.toml", "README.md",
    "vite.config.ts", "next.config.js", "tsconfig.json", ".env.example",
    "docker-compose.yml", "Dockerfile"
}

# Higher = exported first = survives budget cuts
FILE_PRIORITY = {
    # Docs
    "README.md":           100,
    "readme.md":           100,
    # Project config
    "package.json":         95,
    "pyproject.toml":       95,
    "requirements.txt":     90,
    "tsconfig.json":        88,
    "vite.config.ts":       85,
    "vite.config.js":       85,
    "next.config.js":       85,
    "next.config.ts":       85,
    "docker-compose.yml":   80,
    "Dockerfile":           80,
    ".env.example":         75,
    # Lockfiles — structural info but very verbose
    "package-lock.json":    10,
    "yarn.lock":            10,
    "pnpm-lock.yaml":       10,
    "poetry.lock":          10,
    "Cargo.lock":           10,
}

EXTENSION_PRIORITY = {
    ".py":    70,
    ".ts":    70,
    ".tsx":   70,
    ".js":    65,
    ".jsx":   65,
    ".sql":   60,
    ".sh":    55,
    ".md":    50,
    ".json":  45,
    ".yaml":  45,
    ".yml":   45,
    ".toml":  45,
    ".html":  40,
    ".css":   35,
    ".scss":  35,
    ".txt":   30,
    ".ini":   25,
    ".cfg":   25,
    ".ps1":   25,
}

# ============================================================
# SECRET FILTERING
# ============================================================

SECRET_PATTERNS = [
    r'(?i)(api[_-]?key\s*[:=]\s*)["\']?[\w\-]{16,}["\']?',
    r'(?i)(secret[_-]?key\s*[:=]\s*)["\']?[\w\-]{16,}["\']?',
    r'(?i)(auth[_-]?token\s*[:=]\s*)["\']?[\w\-]{16,}["\']?',
    r'(?i)(access[_-]?token\s*[:=]\s*)["\']?[\w\-]{16,}["\']?',
    r'(?i)(password\s*[:=]\s*)["\']?[^\s"\']{8,}["\']?',
    r'(?i)(private[_-]?key\s*[:=]\s*)["\']?[\w\-]{16,}["\']?',
    r'(?i)(database[_-]?url\s*[:=]\s*)["\']?[^\s"\']{8,}["\']?',
    r'(?i)(db[_-]?pass(word)?\s*[:=]\s*)["\']?[^\s"\']{8,}["\']?',
    r'(Bearer\s+)[A-Za-z0-9\-_]{20,}',
    r'(ghp_|gho_|github_pat_)[A-Za-z0-9]{20,}',
    r'(sk-)[A-Za-z0-9]{32,}',          # OpenAI keys
    r'(xoxb-|xoxp-)[A-Za-z0-9\-]+',    # Slack tokens
]

COMPILED_SECRETS = [re.compile(p) for p in SECRET_PATTERNS]

REDACTED = "[REDACTED]"


def redact_secrets(content: str) -> tuple[str, int]:
    """
    Redact secrets from content.
    Returns (redacted_content, count_of_redactions).
    """
    count = 0

    for pattern in COMPILED_SECRETS:
        def replacer(m):
            nonlocal count
            count += 1
            # Keep the key name, redact the value
            if m.lastindex and m.lastindex >= 1:
                return m.group(1) + REDACTED
            return REDACTED

        content = pattern.sub(replacer, content)

    return content, count


# ============================================================
# GITIGNORE SUPPORT
# ============================================================

def load_gitignore(root: Path):
    gitignore_path = root / ".gitignore"

    if not gitignore_path.exists():
        return None

    try:
        import pathspec
        patterns = gitignore_path.read_text(encoding="utf-8", errors="ignore")
        return pathspec.PathSpec.from_lines("gitwildmatch", patterns.splitlines())
    except ImportError:
        print(
            "  [WARNING] pathspec not installed — .gitignore will not be respected.\n"
            "  Run: pip install pathspec",
            file=sys.stderr
        )
        return None


def is_gitignored(path: Path, root: Path, spec) -> bool:
    if spec is None:
        return False
    return spec.match_file(str(path.relative_to(root)))


# ============================================================
# HELPERS
# ============================================================

def is_ignored_dir(path: Path) -> bool:
    return any(part in IGNORE_DIRS for part in path.parts)


def is_important(path: Path) -> bool:
    return (
        path.name in PRIORITY_FILES or
        path.suffix.lower() in IMPORTANT_EXTENSIONS
    )


def is_self(path: Path) -> bool:
    """Exclude this script and its output file."""
    resolved = path.resolve()
    return resolved == SELF_NAME or resolved == OUTPUT_PATH.resolve()


def is_binary(path: Path) -> bool:
    try:
        with open(path, "rb") as f:
            return b"\x00" in f.read(1024)
    except Exception:
        return True


def safe_read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return "[UNICODE DECODE ERROR — file contains non-UTF-8 bytes]"
    except Exception as e:
        return f"[READ ERROR: {e}]"


def file_size_kb(path: Path) -> float:
    return path.stat().st_size / 1024


def text_size_kb(text: str) -> float:
    return len(text.encode("utf-8")) / 1024


def get_priority(path: Path) -> int:
    name_priority = FILE_PRIORITY.get(path.name, None)
    if name_priority is not None:
        return name_priority
    return EXTENSION_PRIORITY.get(path.suffix.lower(), 20)


def section(out, title: str):
    out.write("\n")
    out.write("=" * 80 + "\n")
    out.write(title + "\n")
    out.write("=" * 80 + "\n\n")


# ============================================================
# SCAN PROJECT
# ============================================================

print(f"\nScanning: {ROOT}")

gitignore_spec = load_gitignore(ROOT)

important_files = []

for path in ROOT.rglob("*"):

    if path.is_dir():
        continue

    if is_self(path):
        continue

    if is_ignored_dir(path):
        continue

    if is_gitignored(path, ROOT, gitignore_spec):
        continue

    if not is_important(path):
        continue

    if is_binary(path):
        print(f"  [SKIP BINARY] {path.relative_to(ROOT)}", file=sys.stderr)
        continue

    important_files.append(path)

# Sort by priority descending, then alphabetically for ties
important_files.sort(key=lambda p: (-get_priority(p), str(p.relative_to(ROOT))))

print(f"Found {len(important_files)} files to export.")

# ============================================================
# EXPORT
# ============================================================

total_written_kb  = 0.0
files_written     = 0
files_skipped     = 0
total_redactions  = 0

with open(OUTPUT_FILE, "w", encoding="utf-8") as out:

    section(out, "PROJECT OVERVIEW")
    out.write(f"ROOT:             {ROOT}\n")
    out.write(f"IMPORTANT FILES:  {len(important_files)}\n")
    out.write(f"MAX FILE SIZE:    {MAX_FILE_KB} KB\n")
    out.write(f"MAX TOTAL OUTPUT: {MAX_TOTAL_KB} KB\n\n")

    # --------------------------------------------------------

    section(out, "FOLDER STRUCTURE")

    for file in important_files:
        priority = get_priority(file)
        out.write(f"{str(file.relative_to(ROOT)):<60}  [priority: {priority}]\n")

    # --------------------------------------------------------

    package_json = ROOT / "package.json"

    if package_json.exists():

        section(out, "PACKAGE.JSON SUMMARY")

        try:
            data = json.loads(package_json.read_text())

            out.write(f"NAME:    {data.get('name')}\n")
            out.write(f"VERSION: {data.get('version')}\n\n")

            scripts = data.get("scripts", {})
            if scripts:
                out.write("SCRIPTS:\n")
                for key, value in scripts.items():
                    out.write(f"  {key}: {value}\n")

            deps = data.get("dependencies", {})
            if deps:
                out.write("\nDEPENDENCIES:\n")
                for dep in deps:
                    out.write(f"  - {dep}\n")

            dev_deps = data.get("devDependencies", {})
            if dev_deps:
                out.write("\nDEV DEPENDENCIES:\n")
                for dep in dev_deps:
                    out.write(f"  - {dep}\n")

        except Exception as e:
            out.write(f"[FAILED TO PARSE package.json: {e}]\n")

    # --------------------------------------------------------

    section(out, "FILE CONTENTS")

    for file in important_files:

        relative     = file.relative_to(ROOT)
        source_kb    = file_size_kb(file)

        # Global budget check
        if total_written_kb >= MAX_TOTAL_KB:
            files_skipped += 1
            continue

        content = safe_read(file)

        # Redact secrets
        content, redaction_count = redact_secrets(content)
        total_redactions += redaction_count

        # Build the block first so we measure ACTUAL written size
        block_lines = []
        block_lines.append("\n")
        block_lines.append("-" * 80 + "\n")
        block_lines.append(f"FILE: {relative}\n")

        if redaction_count:
            block_lines.append(f"[{redaction_count} SECRET(S) REDACTED]\n")

        block_lines.append("-" * 80 + "\n")

        if source_kb <= MAX_FILE_KB:
            block_lines.append(content)
            block_lines.append("\n")
        else:
            block_lines.append(
                f"[LARGE FILE: {source_kb:.1f} KB — SHOWING FIRST {PREVIEW_LINES} LINES]\n\n"
            )
            preview = "\n".join(content.splitlines()[:PREVIEW_LINES])
            block_lines.append(preview)
            block_lines.append("\n")

        block = "".join(block_lines)
        block_kb = text_size_kb(block)

        # Would this push us over budget?
        if total_written_kb + block_kb > MAX_TOTAL_KB:
            remaining_kb = MAX_TOTAL_KB - total_written_kb
            out.write(
                f"\n[BUDGET REACHED — {file.name} would add {block_kb:.1f} KB, "
                f"only {remaining_kb:.1f} KB remaining]\n"
            )
            files_skipped += 1
            continue

        out.write(block)
        total_written_kb += block_kb
        files_written += 1

    # --------------------------------------------------------

    if files_skipped:
        section(out, "TRUNCATED")
        out.write(
            f"{files_skipped} file(s) were skipped — budget of {MAX_TOTAL_KB} KB reached.\n"
            f"Use --max-total-kb to increase the limit.\n"
            f"Files are exported highest-priority first, so the most important\n"
            f"files were included before the cutoff.\n"
        )

# ============================================================
# SUMMARY
# ============================================================

print(f"\nDONE.")
print(f"  Output:            {OUTPUT_FILE}")
print(f"  Files written:     {files_written}")
if files_skipped:
    print(f"  Files skipped:     {files_skipped}  (budget)")
if total_redactions:
    print(f"  Secrets redacted:  {total_redactions}")
print(f"  Total output size: {total_written_kb:.1f} KB\n")
