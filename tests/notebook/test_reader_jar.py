"""The reader keeps a minted cookie jar, and mints again only when Google refuses it.

Run with: python3 -m unittest tests/notebook/test_reader_jar.py

The client library is replaced by a stub, so this proves the reader's own rules and nothing about Google.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class AuthError(Exception):
    pass


class MasterTokenError(Exception):
    pass


MINTS: list[str] = []
REFUSE: set[str] = set()  # jars this stub refuses, by the text they carry
FAIL_MINT = False


def install_stubs() -> None:
    notebooklm = types.ModuleType("notebooklm")
    notebooklm.AuthError = AuthError

    class Client:
        @classmethod
        def from_storage(cls, path: Path) -> "Client":
            return cls(path.read_text())

        def __init__(self, jar: str) -> None:
            self.jar = jar

        async def __aenter__(self) -> "Client":
            if any(refused in self.jar for refused in REFUSE):
                raise AuthError("the session is signed out; sign in again")
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        notebooks = types.SimpleNamespace(list=lambda: _notebooks())

    async def _notebooks() -> list:
        return []

    notebooklm.NotebookLMClient = Client

    auth = types.ModuleType("notebooklm.auth")

    async def mint_cookies(email: str, token: str, android: str) -> str:
        if FAIL_MINT:
            raise MasterTokenError("perform_oauth rejected the master token.")
        MINTS.append(token)
        return f"jar-{len(MINTS)}"

    auth.mint_cookies = mint_cookies

    master = types.ModuleType("notebooklm._auth.master_token")
    master.storage_state_from_jar = lambda jar, email=None: {"cookies": jar}

    sys.modules["notebooklm"] = notebooklm
    sys.modules["notebooklm.auth"] = auth
    sys.modules["notebooklm._auth"] = types.ModuleType("notebooklm._auth")
    sys.modules["notebooklm._auth.master_token"] = master


def load_reader():
    spec = importlib.util.spec_from_file_location("notebook_reader", ROOT / "api" / "notebook.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


MASTER = {"email": "a@example.com", "android_id": "1", "master_token": "aas_et/TEST-ONLY"}


class ReaderJar(unittest.TestCase):
    def setUp(self) -> None:
        install_stubs()
        global FAIL_MINT
        MINTS.clear()
        REFUSE.clear()
        FAIL_MINT = False
        self.reader = load_reader()
        self.reader._jars.clear()

    def run_op(self) -> object:
        return asyncio.run(self.reader.run("notebooks", {"master_token": MASTER}, ""))

    def test_a_second_call_within_the_window_reuses_the_jar(self) -> None:
        self.run_op()
        self.run_op()
        self.assertEqual(len(MINTS), 1)

    def test_a_refused_jar_is_minted_once_more_and_the_call_succeeds(self) -> None:
        self.run_op()
        REFUSE.add("jar-1")
        self.assertEqual(self.run_op(), [])
        self.assertEqual(len(MINTS), 2)

    def test_a_failed_mint_is_raised_and_not_retried(self) -> None:
        global FAIL_MINT
        FAIL_MINT = True
        with self.assertRaises(MasterTokenError):
            self.run_op()
        self.assertEqual(MINTS, [])

    def test_an_ordinary_error_is_raised_without_minting_again(self) -> None:
        self.run_op()
        before = len(MINTS)

        class Broken:
            async def __aenter__(self):
                raise ValueError("a notebook id is required")

            async def __aexit__(self, *exc):
                return None

        sys.modules["notebooklm"].NotebookLMClient.from_storage = classmethod(lambda cls, p: Broken())
        with self.assertRaises(ValueError):
            self.run_op()
        self.assertEqual(len(MINTS), before)

    def test_the_stored_jar_path_still_works_without_a_master_token(self) -> None:
        out = asyncio.run(self.reader.run("notebooks", {}, json.dumps({"cookies": "stored"})))
        self.assertEqual(out, [])
        self.assertEqual(MINTS, [])


if __name__ == "__main__":
    unittest.main()
