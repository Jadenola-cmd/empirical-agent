import io
import pandas as pd
import pyreadstat


def load_file(content: bytes, filename: str) -> pd.DataFrame:
    """
    统一文件加载接口，支持 CSV / Excel / DTA
    """
    ext = filename.rsplit(".", 1)[-1].lower()

    if ext == "csv":
        # 自动检测编码
        for encoding in ["utf-8", "gbk", "gb2312", "utf-8-sig"]:
            try:
                return pd.read_csv(io.BytesIO(content), encoding=encoding)
            except UnicodeDecodeError:
                continue
        raise ValueError(f"无法识别 {filename} 的编码格式")

    elif ext in ("xlsx", "xls"):
        return pd.read_excel(io.BytesIO(content))

    elif ext == "dta":
        # pyreadstat 读取 Stata DTA 文件
        with io.BytesIO(content) as buf:
            df, meta = pyreadstat.read_dta(buf)
        return df

    else:
        raise ValueError(f"不支持的文件格式：{ext}，请上传 CSV / Excel / DTA 文件")
