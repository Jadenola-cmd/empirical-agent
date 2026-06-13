from fastapi import APIRouter
from pydantic import BaseModel
import os

router = APIRouter()

# 单一共享激活码：所有高级功能统一解锁（2026-06-13 方案，详见 docs/STATUS.md）
# 生产环境可通过环境变量 ACTIVATION_CODE 覆盖默认值
DEFAULT_ACTIVATION_CODE = "EMPIRICAL2026"


def get_shared_code() -> str:
    return os.environ.get("ACTIVATION_CODE", DEFAULT_ACTIVATION_CODE)


def is_valid_code(code: "str | None") -> bool:
    if not code:
        return False
    return code.strip() == get_shared_code()


class VerifyRequest(BaseModel):
    code: str


@router.post("/verify")
async def verify_code(req: VerifyRequest):
    return {"valid": is_valid_code(req.code)}
