import os
import uuid
import pickle
import time
import pandas as pd

_SESSION_DIR = os.path.join(os.path.dirname(__file__), "..", "_sessions")
_TTL = 7200  # 2 hours


def save_session(dfs: dict) -> str:
    os.makedirs(_SESSION_DIR, exist_ok=True)
    sid = str(uuid.uuid4())
    path = os.path.join(_SESSION_DIR, f"{sid}.pkl")
    with open(path, "wb") as f:
        pickle.dump({"dfs": dfs, "ts": time.time()}, f)
    _cleanup_expired()
    return sid


def load_session(session_id: str) -> dict:
    if not session_id:
        raise ValueError("未提供 session_id")
    path = os.path.join(_SESSION_DIR, f"{session_id}.pkl")
    if not os.path.exists(path):
        raise ValueError("会话已过期，请重新上传文件")
    with open(path, "rb") as f:
        data = pickle.load(f)
    if time.time() - data["ts"] > _TTL:
        os.unlink(path)
        raise ValueError("会话已过期，请重新上传文件")
    return data["dfs"]


def save_cleaned(df: pd.DataFrame) -> str:
    os.makedirs(_SESSION_DIR, exist_ok=True)
    sid = "c_" + str(uuid.uuid4())
    path = os.path.join(_SESSION_DIR, f"{sid}.pkl")
    with open(path, "wb") as f:
        pickle.dump({"df": df, "ts": time.time()}, f)
    return sid


def load_cleaned(session_id: str) -> pd.DataFrame:
    if not session_id:
        raise ValueError("未提供 cleaned_session_id")
    path = os.path.join(_SESSION_DIR, f"{session_id}.pkl")
    if not os.path.exists(path):
        raise ValueError("清洗会话已过期，请重新执行清洗")
    with open(path, "rb") as f:
        data = pickle.load(f)
    if time.time() - data["ts"] > _TTL:
        os.unlink(path)
        raise ValueError("清洗会话已过期，请重新执行清洗")
    return data["df"]


def _cleanup_expired():
    try:
        for fname in os.listdir(_SESSION_DIR):
            fpath = os.path.join(_SESSION_DIR, fname)
            if fname.endswith(".pkl") and os.path.isfile(fpath):
                if time.time() - os.path.getmtime(fpath) > _TTL:
                    os.unlink(fpath)
    except Exception:
        pass
