#!/usr/bin/env python3
"""Read-only smoke check for the public English JT Games release (stdlib only)."""

from __future__ import annotations

import argparse
import hashlib
from html.parser import HTMLParser
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.lang = ""
        self.links: list[str] = []
        self.title: list[str] = []
        self.in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "html":
            self.lang = values.get("lang") or ""
        if tag == "a" and values.get("href"):
            self.links.append(values["href"] or "")
        if tag == "title":
            self.in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title.append(data)


def fetch(url: str) -> tuple[bytes, str, str]:
    request = Request(url, headers={
        "User-Agent": "JT-Games-English-Release-Check/1.0",
        # A Chinese browser must still receive English on a first visit.
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
    })
    with urlopen(request, timeout=30) as response:
        return response.read(), response.headers.get_content_type(), response.url


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="https://jtmakegames.com")
    parser.add_argument("--pdf", type=Path, help="Local approved PDF for exact SHA-256 comparison")
    args = parser.parse_args()
    base = args.base.rstrip("/") + "/"
    pdf_path = "/pnp/Jukebox_PnP_EN.pdf"
    failures: list[str] = []

    for route in ("/", "/jukebox/", "/jukebox/?play=table", "/sushi/"):
        try:
            data, content_type, final_url = fetch(urljoin(base, route))
            if content_type != "text/html":
                failures.append(f"{route}: expected HTML, received {content_type}")
                continue
            page = Page()
            page.feed(data.decode("utf-8"))
            if page.lang not in ("en", "en-US", "en-GB"):
                failures.append(f"{route}: initial HTML language is {page.lang!r}, not English")
            if any("\u3400" <= char <= "\u9fff" for char in "".join(page.title)):
                failures.append(f"{route}: initial page title still contains Chinese")
            if route == "/jukebox/":
                link_paths = {urlsplit(urljoin(final_url, link)).path for link in page.links}
                if pdf_path not in link_paths:
                    failures.append(f"{route}: English PnP download link is missing from initial HTML")
                if "/pnp/jukebox-pnp-a4.pdf" in link_paths:
                    failures.append(f"{route}: old PnP link remains in initial HTML")
            print(f"CHECK {route}: lang={page.lang!r}, title={''.join(page.title)!r}")
        except (HTTPError, URLError, TimeoutError, UnicodeError) as error:
            failures.append(f"{route}: {error}")

    try:
        pdf_data, content_type, _ = fetch(urljoin(base, pdf_path))
        if not pdf_data.startswith(b"%PDF-"):
            failures.append(f"{pdf_path}: response is not a PDF")
        if content_type not in ("application/pdf", "application/octet-stream"):
            failures.append(f"{pdf_path}: unexpected content type {content_type}")
        digest = hashlib.sha256(pdf_data).hexdigest()
        print(f"CHECK {pdf_path}: {len(pdf_data):,} bytes, SHA-256 {digest}")
        if args.pdf:
            expected = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
            if digest != expected:
                failures.append("Published PDF does not match the approved local PDF")
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        failures.append(f"{pdf_path}: {error}")

    if failures:
        for failure in failures:
            print(f"FAIL {failure}", file=sys.stderr)
        return 1
    print("PASS HTTP checks. Complete the browser language and gameplay checks in docs/english-release.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
