#!/usr/bin/env python3
"""Arranca el servidor de desarrollo. Equivalente a: uvicorn src.app:app --reload"""
import subprocess, sys
subprocess.run(
    [sys.executable, "-m", "uvicorn", "src.app:app", "--reload", "--port", "8000"],
    check=True,
)
